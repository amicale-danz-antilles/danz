/** Local SQLite rehearsal with a fixed, entirely synthetic PostgreSQL fixture. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { compareSnapshots } from "./compare-snapshots.mjs";
import { readPgCopy } from "./read-pg-copy.mjs";

const contract = JSON.parse(readFileSync(new URL("./source-contract.json", import.meta.url), "utf8"));
const fixture = new URL("./fixtures/phase-1/", import.meta.url);
const sourceSql = readFileSync(new URL("data.sql", fixture), "utf8");
const expectedTables = JSON.parse(readFileSync(new URL("expected-tables.json", fixture), "utf8"));
const treasurySql = readFileSync(new URL("treasury-balances.sql", fixture), "utf8");
const expectedBalances = { bank_cents: 10500, cash_cents: 600, unassigned_cents: 400, total_cents: 11500 };

// Explicit types and relationships for the abbreviated fixture, not a production mapping.
const integerKeys = {
  association_settings: ["id"],
  treasury_import_archive_lines: ["source_row"],
  treasury_opening: ["id"],
};
const additionalColumns = {
  events: { title: "text" },
  households: { name: "text" },
  household_charges: { household_id: "text", amount_cents: "integer" },
  household_members: { household_id: "text", user_id: "nullable_text" },
  household_payment_allocations: { amount_cents: "integer" },
  household_payments: { household_id: "text", amount_cents: "integer" },
  membership_subscriptions: { household_id: "text", amount_cents: "integer" },
  poll_options: { poll_id: "text" },
  poll_question_answers: { answer: "text" },
  poll_questions: { poll_id: "text" },
  poll_votes: { option_id: "text" },
  profiles: { active: "boolean", is_treasurer: "boolean", note: "nullable_text" },
  treasury_entries: {
    kind: "text",
    status: "text",
    payment_method: "text",
    amount_cents: "integer",
    household_payment_id: "nullable_text",
  },
  treasury_import_archive_lines: { income_cents: "nullable_integer", expense_cents: "nullable_integer" },
  treasury_opening: { bank_cents: "integer", cash_cents: "integer" },
  treasury_transfers: { from_account: "text", to_account: "text", amount_cents: "integer" },
};
const foreignKeys = {
  household_charges: [["household_id", "households"]],
  household_members: [["household_id", "households"], ["user_id", "profiles"]],
  household_payment_allocations: [["payment_id", "household_payments"], ["charge_id", "household_charges"]],
  household_payments: [["household_id", "households"]],
  membership_subscriptions: [["household_id", "households"]],
  notification_preferences: [["user_id", "profiles"]],
  poll_household_attendance: [["poll_id", "polls"], ["household_member_id", "household_members"]],
  poll_options: [["poll_id", "polls"]],
  poll_question_answers: [["question_id", "poll_questions"], ["user_id", "profiles"]],
  poll_questions: [["poll_id", "polls"]],
  poll_votes: [["poll_id", "polls"], ["user_id", "profiles"], ["option_id", "poll_options"]],
  treasury_entries: [["household_payment_id", "household_payments"]],
  treasury_import_archive_lines: [["batch_id", "treasury_import_batches"]],
};

const quote = identifier => '"' + identifier.replaceAll('"', '""') + '"';
const names = columns => columns.map(quote).join(", ");
const notNull = type => !type.startsWith("nullable_");
const affinity = type => type.endsWith("text") ? "TEXT" : "INTEGER";

const tables = new Map(contract.tables.map(({ name, primaryKey }) => [name, {
  primaryKey,
  columns: {
    ...Object.fromEntries(primaryKey.map(key => [key, integerKeys[name]?.includes(key) ? "integer" : "text"])),
    ...additionalColumns[name],
  },
  references: foreignKeys[name] ?? [],
}]));

function createTable(db, name, spec) {
  const columns = Object.entries(spec.columns).map(([column, type]) =>
    `${quote(column)} ${affinity(type)}${notNull(type) ? " NOT NULL" : ""}` +
    (type === "boolean" ? ` CHECK (${quote(column)} IN (0, 1))` : "")
  );
  const references = spec.references.map(([column, parent]) =>
    `FOREIGN KEY (${quote(column)}) REFERENCES ${quote(parent)} ("id")`
  );
  db.exec(`CREATE TABLE ${quote(name)} (${[
    ...columns,
    `PRIMARY KEY (${names(spec.primaryKey)})`,
    ...references,
  ].join(", ")}) STRICT`);
}

function sqliteValue(value, type) {
  if (value === null && !notNull(type)) return null;
  if (typeof value !== "string") throw new Error("invalid_source_value");
  if (affinity(type) === "TEXT") return value;
  if (type === "boolean") {
    if (value === "t") return 1;
    if (value === "f") return 0;
    throw new Error("invalid_source_boolean");
  }
  // No decimal rounding or conversion through floating point for amounts or keys.
  if (!/^-?[0-9]+$/.test(value)) throw new Error("invalid_source_integer");
  const integer = BigInt(value);
  if (integer < BigInt(Number.MIN_SAFE_INTEGER) || integer > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("unsafe_source_integer");
  }
  return integer;
}

function collectInserts(db, copySql) {
  const visited = new Set();
  let insert;
  readPgCopy(copySql, {
    onBlock(block) {
      const spec = tables.get(block.table);
      if (block.schema !== "public" || !spec) throw new Error("unexpected_source_table");
      const columns = new Set(block.columns);
      if (columns.size !== Object.keys(spec.columns).length ||
          block.columns.some(column => !Object.hasOwn(spec.columns, column))) {
        throw new Error("invalid_source_columns");
      }
      visited.add(block.table);
      insert = db.prepare(`INSERT INTO ${quote(block.table)} (${names(block.columns)}) VALUES (${
        block.columns.map(() => "?").join(", ")
      })`);
    },
    onRow(block, row) {
      const { columns } = tables.get(block.table);
      insert.run(...row.map((value, index) => sqliteValue(value, columns[block.columns[index]])));
    },
  });
  if (visited.size !== tables.size) throw new Error("missing_source_copy");
}

/** Import step. Returns a fresh disposable SQLite database or rolls back and throws. */
export function importSyntheticCopy(copySql = sourceSql) {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON; BEGIN; PRAGMA defer_foreign_keys = ON");
    for (const [name, spec] of tables) createTable(db, name, spec);
    collectInserts(db, copySql);
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("source_foreign_key_violation");
    db.exec("COMMIT");
    return db;
  } catch (error) {
    db.close();
    if (error.errcode === 1555 || error.errcode === 2067) throw new Error("duplicate_source_primary_key");
    throw error;
  }
}

function sqliteTableMatches(db, name, spec) {
  const columns = db.prepare(`PRAGMA table_xinfo(${quote(name)})`).all();
  const expected = Object.entries(spec.columns);
  const actualFks = db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all().map(key =>
    JSON.stringify([key.from, key.table, key.to, key.on_update, key.on_delete, key.match])
  ).sort();
  const expectedFks = spec.references.map(([column, parent]) =>
    JSON.stringify([column, parent, "id", "NO ACTION", "NO ACTION", "NONE"])
  ).sort();
  return columns.length === expected.length && expected.every(([column, type], index) => {
    const actual = columns[index];
    return actual.name === column && actual.type === affinity(type) && actual.notnull === Number(notNull(type)) &&
      actual.pk === spec.primaryKey.indexOf(column) + 1 && actual.hidden === 0;
  }) && JSON.stringify(actualFks) === JSON.stringify(expectedFks);
}

function captureSqliteTables(db, issues) {
  const tableList = db.prepare("PRAGMA main.table_list").all().filter(({ name }) => name !== "sqlite_schema");
  if (tableList.length !== tables.size || tableList.some(({ name, type, strict }) =>
    !tables.has(name) || type !== "table" || strict !== 1
  )) {
    issues.push({ area: "sqlite_schema", reason: "unexpected_table_set" });
    return null;
  }
  const result = {};
  for (const [name, spec] of tables) {
    if (!sqliteTableMatches(db, name, spec)) {
      issues.push({ area: "table:" + name, reason: "sqlite_schema_mismatch" });
      continue;
    }
    // Read every field from SQLite. The expected rows come from a separate checked-in fixture.
    result[name] = db.prepare(`SELECT * FROM ${quote(name)}`).all().map(row => {
      for (const [column, type] of Object.entries(spec.columns)) {
        if (type !== "boolean") continue;
        if (row[column] !== 0 && row[column] !== 1) throw new Error("invalid_target_boolean");
        row[column] = Boolean(row[column]);
      }
      return row;
    });
  }
  if (db.prepare("PRAGMA foreign_key_check").all().length) {
    issues.push({ area: "sqlite_schema", reason: "sqlite_foreign_key_violation" });
  }
  return result;
}

function snapshot(tables) {
  // This rehearsal covers business tables. Files and auth have separate checks.
  return { format: "DANZ-PRIVATE-1", tables, assets: [], authAccounts: [] };
}

/** Verification step. Reads SQLite and compares it to the separate fixture oracle. */
export function verifySyntheticParity(db) {
  const issues = [];
  try {
    const actualTables = captureSqliteTables(db, issues);
    if (!actualTables || issues.length) return { ok: false, tablesChecked: 0, issues };
    const result = compareSnapshots(snapshot(expectedTables), snapshot(actualTables));
    const balancesCents = { ...db.prepare(treasurySql).get() };
    if (Object.entries(expectedBalances).some(([account, cents]) => balancesCents[account] !== cents)) {
      result.issues.push({ area: "treasury", reason: "synthetic_balance_mismatch" });
    }
    return {
      ok: result.ok && !result.issues.length,
      tablesChecked: result.areasChecked - 2,
      balancesCents,
      issues: result.issues,
    };
  } catch (_) {
    return { ok: false, tablesChecked: 0, issues: [{ area: "sqlite", reason: "unreadable_target" }] };
  }
}

function cli() {
  if (process.argv.length !== 2) {
    console.error("Usage: node migration/dry-run.mjs");
    process.exitCode = 2;
    return;
  }
  let db;
  try {
    db = importSyntheticCopy();
    const report = verifySyntheticParity(db);
    console.log(JSON.stringify({ fixture: "synthetic", target: "sqlite-memory", ...report }, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (_) {
    console.error("Synthetic SQLite import failed");
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
