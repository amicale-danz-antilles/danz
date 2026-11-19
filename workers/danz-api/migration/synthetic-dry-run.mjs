/** Offline demonstration only: imports built-in artificial COPY into in-memory SQLite.
 * No network, credentials, external SQL files or remote D1. Not a PostgreSQL restore.
 */
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareSnapshots } from "./compare-snapshots.mjs";
import { syntheticTables, syntheticContract, createSyntheticFixture, assetManifest } from "./synthetic-fixtures.mjs";

function decode(value) {
  if (value === "\\N") return null;
  if (value.includes("\0")) throw new Error("invalid_synthetic_copy_value");
  let out = "";
  for (let n = 0; n < value.length; n++) {
    if (value[n] !== "\\") { out += value[n]; continue; }
    const escaped = value[++n];
    if (!(escaped in { t: 1, n: 1, r: 1, "\\": 1 })) throw new Error("unsupported_synthetic_copy_escape");
    out += { t: "\t", n: "\n", r: "\r", "\\": "\\" }[escaped];
  }
  return out;
}

export function parseSyntheticCopy(dump) {
  if (typeof dump !== "string" || !dump.startsWith("-- DANZ-SYNTHETIC-COPY-1\n")) throw new Error("not_a_synthetic_fixture");
  const lines = dump.split("\n"), tables = {};
  let current = null;
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (!current) {
      if (line === "" && n === lines.length - 1) continue;
      const header = /^COPY public\.([a-z_]+) \(([a-z_, ]+)\) FROM stdin;$/.exec(line);
      if (!header) throw new Error("invalid_synthetic_copy_statement");
      const spec = syntheticTables.find(t => t.name === header[1]);
      if (!spec || Object.hasOwn(tables, spec.name)) throw new Error("unknown_or_duplicate_synthetic_table");
      if (header[2] !== spec.columns.map(c => c.name).join(", ")) throw new Error("synthetic_columns_mismatch");
      current = spec;
      tables[spec.name] = [];
      continue;
    }
    if (line === "\\.") { current = null; continue; }
    const cells = line.split("\t");
    if (cells.length !== current.columns.length) throw new Error("synthetic_copy_column_count_mismatch");
    const row = {};
    current.columns.forEach((column, i) => {
      let value = decode(cells[i]);
      if (value === null && !column.nullable) throw new Error("synthetic_not_null_violation");
      if (value !== null && column.type === "INTEGER") {
        if (!/^-?(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("unsafe_synthetic_integer");
        value = Number(value);
      }
      row[column.name] = value;
    });
    tables[current.name].push(row);
  }
  if (current) throw new Error("unterminated_synthetic_copy");
  if (Object.keys(tables).length !== syntheticTables.length) throw new Error("required_synthetic_copy_missing");
  return tables;
}

const q = name => `"${name}"`;
export function openSyntheticDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const table of syntheticTables) {
    const definitions = table.columns.map(c => `${q(c.name)} ${c.type}${c.nullable ? "" : " NOT NULL"}`);
    definitions.push(`PRIMARY KEY (${table.primaryKey.map(q).join(", ")})`);
    for (const fk of table.foreignKeys) definitions.push(`FOREIGN KEY (${q(fk.column)}) REFERENCES ${q(fk.table)} (${q(fk.target)}) DEFERRABLE INITIALLY DEFERRED`);
    db.exec(`CREATE TABLE ${q(table.name)} (${definitions.join(", ")}) STRICT`);
  }
  db.exec("CREATE TABLE synthetic_identity_manifest (id TEXT PRIMARY KEY NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)), is_treasurer INTEGER NOT NULL CHECK(is_treasurer IN (0,1)), household_id TEXT, FOREIGN KEY(household_id) REFERENCES households(id)) STRICT");
  return db;
}

export function importSyntheticCopy(db, dump, authAccounts) {
  const tables = parseSyntheticCopy(dump);
  db.exec("BEGIN");
  try {
    for (const table of syntheticTables) {
      const statement = db.prepare(`INSERT INTO ${q(table.name)} (${table.columns.map(c => q(c.name)).join(", ")}) VALUES (${table.columns.map(() => "?").join(", ")})`);
      for (const row of tables[table.name]) statement.run(...table.columns.map(c => row[c.name]));
    }
    const identity = db.prepare("INSERT INTO synthetic_identity_manifest VALUES (?, ?, ?, ?, ?)");
    for (const account of authAccounts) identity.run(account.id, account.role, Number(account.active), Number(account.is_treasurer), account.household_id);
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("synthetic_foreign_key_violation");
    db.exec("COMMIT");
  } catch (_) {
    db.exec("ROLLBACK");
    // Never return SQLite errors which could contain a value from input.
    throw new Error("synthetic_import_rejected");
  }
}

export function readSyntheticSnapshot(db, objects) {
  const tables = Object.fromEntries(syntheticTables.map(table => [table.name, db.prepare(`SELECT * FROM ${q(table.name)}`).all().map(row => ({ ...row }))]));
  const authAccounts = db.prepare("SELECT * FROM synthetic_identity_manifest").all().map(row => ({ ...row, active: !!row.active, is_treasurer: !!row.is_treasurer }));
  return { format: "DANZ-PRIVATE-1", tables, assets: assetManifest(objects), authAccounts };
}

export function syntheticFinanceCheck(db) {
  const opening = db.prepare("SELECT SUM(bank_cents) AS bank, SUM(cash_cents) AS cash FROM treasury_opening").get();
  const balances = { bank: opening.bank || 0, cash: opening.cash || 0 };
  for (const row of db.prepare("SELECT amount_cents, kind, account FROM treasury_entries").all()) {
    if (!["income", "expense"].includes(row.kind) || !Object.hasOwn(balances, row.account)) throw new Error("invalid_synthetic_finance");
    balances[row.account] += (row.kind === "income" ? 1 : -1) * row.amount_cents;
  }
  for (const row of db.prepare("SELECT amount_cents, from_account, to_account FROM treasury_transfers").all()) {
    if (!Object.hasOwn(balances, row.from_account) || !Object.hasOwn(balances, row.to_account) || row.from_account === row.to_account || row.amount_cents <= 0) throw new Error("invalid_synthetic_transfer");
    balances[row.from_account] -= row.amount_cents;
    balances[row.to_account] += row.amount_cents;
  }
  if (!Object.values(balances).every(Number.isSafeInteger)) throw new Error("unsafe_synthetic_balance");
  const inconsistent = db.prepare(`SELECT COUNT(*) AS n FROM household_payment_allocations a
    JOIN household_payments p ON p.id = a.payment_id JOIN household_charges c ON c.id = a.charge_id
    WHERE p.household_id <> c.household_id OR a.amount_cents <= 0`).get().n;
  const excess = db.prepare(`SELECT COUNT(*) AS n FROM (
    SELECT p.id FROM household_payments p JOIN household_payment_allocations a ON a.payment_id=p.id GROUP BY p.id HAVING SUM(a.amount_cents)>p.amount_cents
    UNION ALL SELECT c.id FROM household_charges c JOIN household_payment_allocations a ON a.charge_id=c.id GROUP BY c.id HAVING SUM(a.amount_cents)>c.amount_cents
  )`).get().n;
  return { ok: inconsistent === 0 && excess === 0 && balances.bank === 18500 && balances.cash === 3500, bankCents: balances.bank, cashCents: balances.cash, totalCents: balances.bank + balances.cash };
}

export function runSyntheticDryRun() {
  const fixture = createSyntheticFixture(), db = openSyntheticDatabase();
  try {
    importSyntheticCopy(db, fixture.dump, fixture.snapshot.authAccounts);
    const copiedObjects = new Map([...fixture.objects].map(([key, bytes]) => [key, Buffer.from(bytes)]));
    const parity = compareSnapshots(fixture.snapshot, readSyntheticSnapshot(db, copiedObjects));
    const finance = syntheticFinanceCheck(db);
    return {
      ok: parity.ok && finance.ok, scope: "SYNTHETIC-ONLY", target: "in-memory SQLite, no remote D1", tablesChecked: syntheticTables.length,
      compositePrimaryKeys: syntheticTables.filter(t => t.primaryKey.length > 1).length,
      syntheticRows: syntheticTables.reduce((n, t) => n + fixture.snapshot.tables[t.name].length, 0),
      parity, finance, edgeFunctionsInventoried: syntheticContract.edgeFunctions.length,
      productionSchemaRestored: false, realBackupVerified: false, edgeFunctionBehaviorVerified: false,
      productionReadiness: "NO-GO",
    };
  } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error("Synthetic dry-run accepts no input file or connection.");
    process.exitCode = 2;
  } else {
    try {
      const result = runSyntheticDryRun();
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    } catch (_) {
      console.error("Synthetic dry-run stopped; no production operation was attempted.");
      process.exitCode = 1;
    }
  }
}
