import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationDir = new URL("../migration/", import.meta.url);
const contract = JSON.parse(readFileSync(new URL("source-contract.json", migrationDir), "utf8"));

test("le SQL de comptage recense chaque table publique du contrat une seule fois", () => {
  assert.deepEqual(contract.sourceSchemas, ["public"]);
  const sql = readFileSync(new URL("source-counts.sql", migrationDir), "utf8");
  const counts = [...sql.matchAll(
    /^SELECT '([a-z_]+)' AS table_name, COUNT\(\*\)::bigint AS row_count FROM public\.([a-z_]+)$/gm,
  )];
  assert.equal(counts.length, 36);
  for (const [, label, table] of counts) {
    assert.equal(label, table);
  }
  const names = counts.map(([, , table]) => table);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names.sort(), contract.tables.map(({ name }) => name).sort());
});

test("l’ordre des champs des cinq clés primaires composées est préservé", () => {
  const compoundKeys = Object.fromEntries(contract.tables
    .filter(({ primaryKey }) => primaryKey.length > 1)
    .map(({ name, primaryKey }) => [name, primaryKey]));
  assert.deepEqual(compoundKeys, {
    household_payment_allocations: ["payment_id", "charge_id"],
    poll_household_attendance: ["poll_id", "household_member_id"],
    poll_question_answers: ["question_id", "user_id"],
    poll_votes: ["poll_id", "user_id"],
    treasury_import_archive_lines: ["batch_id", "source_row"],
  });
});

test("le suivi couvre les neuf fonctions Edge et le contrat couvre les appels frontend connus", () => {
  const edgeFunctions = new Set(contract.edgeFunctions);
  assert.equal(edgeFunctions.size, 9);
  assert.equal(contract.edgeFunctions.length, edgeFunctions.size);

  const inventory = readFileSync(new URL("INVENTAIRE-PHASE-1.md", migrationDir), "utf8");
  const [, edgeSection] = inventory.split(/^## Fonctions Edge$/m);
  assert.ok(edgeSection);
  const documented = [...edgeSection.split(/^## /m)[0].matchAll(/^\| `([a-z0-9-]+)` \|/gm)]
    .map(([, name]) => name);
  assert.deepEqual(documented.sort(), [...edgeFunctions].sort());

  const frontendDir = fileURLToPath(new URL("../../../src/", import.meta.url));
  const directCalls = new Set();
  for (const file of readdirSync(frontendDir, { recursive: true })) {
    if (!/\.jsx?$/.test(file)) continue;
    const source = readFileSync(join(frontendDir, file), "utf8");
    for (const [, name] of source.matchAll(/\.functions\.invoke\(\s*['"]([a-z0-9-]+)['"]/g)) {
      directCalls.add(name);
    }
  }
  assert.ok(directCalls.size > 0);
  assert.deepEqual([...directCalls].filter((name) => !edgeFunctions.has(name)), []);
});
