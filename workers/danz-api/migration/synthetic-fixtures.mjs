/** Built-in artificial fixtures only. This is NOT the production DANZ schema. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const syntheticContract = JSON.parse(readFileSync(new URL("./source-contract.json", import.meta.url), "utf8"));
const relation = (column, table, target = "id") => ({ column, table, target });
const relations = {
  profiles: [relation("household_id", "households")],
  household_members: [relation("household_id", "households")],
  household_charges: [relation("household_id", "households")],
  household_payments: [relation("household_id", "households")],
  household_payment_allocations: [relation("payment_id", "household_payments"), relation("charge_id", "household_charges")],
  notification_preferences: [relation("user_id", "profiles")],
  poll_options: [relation("poll_id", "polls")],
  poll_questions: [relation("poll_id", "polls")],
  poll_votes: [relation("poll_id", "polls"), relation("user_id", "profiles")],
  poll_question_answers: [relation("question_id", "poll_questions"), relation("user_id", "profiles")],
  poll_household_attendance: [relation("poll_id", "polls"), relation("household_member_id", "household_members")],
  treasury_import_archive_lines: [relation("batch_id", "treasury_import_batches")],
};
const fields = {
  profiles: [["role", "TEXT"], ["active", "INTEGER"], ["is_treasurer", "INTEGER"]],
  household_charges: [["amount_cents", "INTEGER"]],
  household_payments: [["amount_cents", "INTEGER"]],
  household_payment_allocations: [["amount_cents", "INTEGER"]],
  treasury_entries: [["amount_cents", "INTEGER"], ["kind", "TEXT"], ["account", "TEXT"]],
  treasury_opening: [["bank_cents", "INTEGER"], ["cash_cents", "INTEGER"]],
  treasury_transfers: [["amount_cents", "INTEGER"], ["from_account", "TEXT"], ["to_account", "TEXT"]],
};

export const syntheticTables = syntheticContract.tables.map(item => {
  const columns = item.primaryKey.map(name => ({ name, type: name === "source_row" ? "INTEGER" : "TEXT", nullable: false }));
  for (const fk of relations[item.name] || []) {
    if (!columns.some(c => c.name === fk.column)) columns.push({ name: fk.column, type: "TEXT", nullable: false });
  }
  for (const [name, type] of fields[item.name] || []) columns.push({ name, type, nullable: false });
  columns.push({ name: "synthetic_note", type: "TEXT", nullable: false }, { name: "optional_note", type: "TEXT", nullable: true });
  return { ...item, columns, foreignKeys: relations[item.name] || [] };
});

const demoId = (table, index) => `SYNTHETIC-${table}-${index}`;
function rowFor(table, index) {
  const row = {};
  for (const column of table.columns) {
    const fk = table.foreignKeys.find(f => f.column === column.name);
    if (fk) row[column.name] = demoId(fk.table, index);
    else if (table.primaryKey.includes(column.name)) row[column.name] = column.type === "INTEGER" ? index : demoId(table.name, index);
    else if (column.name === "synthetic_note") row[column.name] = `FICTIF ${index} : é\tligne\nretour\rbarre\\fin`;
    else if (column.name === "optional_note") row[column.name] = index === 1 ? null : "\\N";
    else if (column.name.endsWith("_cents")) row[column.name] = index === 1 ? 6000 : 2000;
    else row[column.name] = "SYNTHETIC";
  }
  if (table.name === "profiles") Object.assign(row, { role: index === 1 ? "admin" : "member", active: 1, is_treasurer: index === 1 ? 1 : 0 });
  if (table.name === "treasury_entries") Object.assign(row, { amount_cents: index === 1 ? 12345 : 2345, kind: index === 1 ? "income" : "expense", account: "bank" });
  if (table.name === "treasury_opening") Object.assign(row, { bank_cents: 10000, cash_cents: 2000 });
  if (table.name === "treasury_transfers") Object.assign(row, { amount_cents: 1500, from_account: "bank", to_account: "cash" });
  return row;
}

function copyValue(value) {
  if (value === null) return "\\N";
  return String(value).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

export function encodeSyntheticCopy(tables) {
  let dump = "-- DANZ-SYNTHETIC-COPY-1\n";
  for (const table of syntheticTables) {
    dump += `COPY public.${table.name} (${table.columns.map(c => c.name).join(", ")}) FROM stdin;\n`;
    for (const row of tables[table.name]) dump += table.columns.map(c => copyValue(row[c.name])).join("\t") + "\n";
    dump += "\\.\n";
  }
  return dump;
}

export function assetManifest(objects) {
  return [...objects].map(([key, bytes]) => ({ key, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }));
}

export function createSyntheticFixture() {
  const tables = Object.fromEntries(syntheticTables.map(table => [table.name,
    Array.from({ length: ["treasury_opening", "treasury_transfers"].includes(table.name) ? 1 : 2 }, (_, n) => rowFor(table, n + 1)),
  ]));
  const authAccounts = tables.profiles.map(row => ({ id: row.id, role: row.role, active: !!row.active, is_treasurer: !!row.is_treasurer, household_id: row.household_id }));
  const objects = new Map([
    ["r2/synthetic-only/document.txt", Buffer.from("FICHIER R2 ENTIÈREMENT FICTIF\n")],
    ["supabase-storage/synthetic-only/photo.bin", Buffer.from([0, 1, 2, 3, 254, 255])],
  ]);
  return { dump: encodeSyntheticCopy(tables), snapshot: { format: "DANZ-PRIVATE-1", tables, assets: assetManifest(objects), authAccounts }, objects };
}
