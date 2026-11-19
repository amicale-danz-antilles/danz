import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importSyntheticCopy, verifySyntheticParity } from "../migration/dry-run.mjs";

const script = fileURLToPath(new URL("../migration/dry-run.mjs", import.meta.url));
const sourceSql = readFileSync(new URL("../migration/fixtures/phase-1/data.sql", import.meta.url), "utf8");

function load(testCase, sql) {
  const db = importSyntheticCopy(sql);
  testCase.after(() => db.close());
  return db;
}

test("le dry-run relit 36 tables et rapproche les balances en centimes dans SQLite", t => {
  const db = load(t);
  assert.deepEqual(verifySyntheticParity(db), {
    ok: true,
    tablesChecked: 36,
    balancesCents: { bank_cents: 10500, cash_cents: 600, unassigned_cents: 400, total_cents: 11500 },
    issues: [],
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gallery").get().n, 0);
  assert.equal(db.prepare("SELECT note FROM profiles WHERE id = 'FICT-admin'").get().note, "\\N");
  assert.equal(db.prepare("SELECT note FROM profiles WHERE id = 'FICT-member'").get().note, null);
  assert.equal(db.prepare("SELECT note FROM profiles WHERE id = 'FICT-inactive'").get().note, "");
  assert.equal(db.prepare("SELECT answer FROM poll_question_answers").get().answer, "Ligne 1\nLigne 2\tFin");
  assert.equal(db.prepare("SELECT typeof(amount_cents) AS type FROM treasury_entries").get().type, "integer");
});

test("l'oracle indépendant détecte une ligne absente dans le COPY", t => {
  const missing = sourceSql.replace("FICT-news\n", "");
  assert.notEqual(missing, sourceSql);
  const report = verifySyntheticParity(load(t, missing));
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue => issue.area === "table:news" && issue.missing === 1));
});

test("la parité détecte la perte d'une clé composée sans révéler ses valeurs", t => {
  const db = load(t);
  assert.equal(db.prepare("DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?")
    .run("FICT-poll", "FICT-member").changes, 1);
  const report = verifySyntheticParity(db);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue => issue.area === "table:poll_votes" && issue.missing === 1));
  assert.doesNotMatch(JSON.stringify(report), /FICT-/);
});

test("un centime modifié échoue à la parité et au rapprochement", t => {
  const db = load(t);
  assert.equal(db.prepare("UPDATE treasury_entries SET amount_cents = 1499 WHERE id = 'FICT-income'").run().changes, 1);
  const report = verifySyntheticParity(db);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue => issue.area === "table:treasury_entries" && issue.changed === 1));
  assert.ok(report.issues.some(issue => issue.area === "treasury" && issue.reason === "synthetic_balance_mismatch"));
  assert.equal(report.balancesCents.bank_cents, 10499);
});

test("la parité détecte des écarts compensés qui préservent les soldes", t => {
  const db = load(t);
  db.exec("UPDATE treasury_opening SET bank_cents = bank_cents - 1");
  assert.equal(db.prepare("UPDATE treasury_entries SET amount_cents = amount_cents + 1 WHERE id = ?")
    .run("FICT-income").changes, 1);
  const report = verifySyntheticParity(db);
  assert.equal(report.ok, false);
  assert.equal(report.balancesCents.bank_cents, 10500);
  assert.equal(report.balancesCents.total_cents, 11500);
  assert.ok(report.issues.some(issue => issue.area === "table:treasury_entries" && issue.changed === 1));
  assert.ok(report.issues.some(issue => issue.area === "table:treasury_opening" && issue.changed === 1));
});

test("une clé primaire dupliquée dans le COPY bloque l'import", () => {
  const row = "FICT-poll\tFICT-admin\tFICT-option\n";
  const duplicate = sourceSql.replace(row, row + row);
  assert.notEqual(duplicate, sourceSql);
  assert.throws(() => importSyntheticCopy(duplicate), /duplicate_source_primary_key/);
});

test("une référence orpheline dans le COPY bloque l'import", () => {
  const orphan = sourceSql.replace("FICT-charge\tFICT-household\t1500", "FICT-charge\tFICT-absent\t1500");
  assert.notEqual(orphan, sourceSql);
  assert.throws(() => importSyntheticCopy(orphan), /source_foreign_key_violation/);
});

test("l'import refuse une table vide sans COPY et des colonnes incohérentes", () => {
  const missing = sourceSql.replace("COPY public.gallery (id) FROM stdin;\n\\.\n", "");
  assert.notEqual(missing, sourceSql);
  assert.throws(() => importSyntheticCopy(missing), /missing_source_copy/);

  const wrongColumn = sourceSql.replace("events (id, title)", "events (id, fake_title)");
  assert.notEqual(wrongColumn, sourceSql);
  assert.throws(() => importSyntheticCopy(wrongColumn), /invalid_source_columns/);
});

test("les valeurs monétaires ambiguës ou non représentables bloquent l'import", () => {
  const amount = "FICT-charge\tFICT-household\t1500";
  for (const [value, reason] of [["14.99", /invalid_source_integer/], ["9007199254740993", /unsafe_source_integer/]]) {
    const mutated = sourceSql.replace(amount, "FICT-charge\tFICT-household\t" + value);
    assert.notEqual(mutated, sourceSql);
    assert.throws(() => importSyntheticCopy(mutated), reason);
  }
});

test("la parité détecte la disparition d'une contrainte de clé étrangère", t => {
  const db = load(t);
  db.exec(
    "ALTER TABLE notification_preferences RENAME TO old_prefs;" +
    "CREATE TABLE notification_preferences (user_id TEXT NOT NULL PRIMARY KEY) STRICT;" +
    "INSERT INTO notification_preferences SELECT user_id FROM old_prefs;" +
    "DROP TABLE old_prefs;"
  );
  const report = verifySyntheticParity(db);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue =>
    issue.area === "table:notification_preferences" && issue.reason === "sqlite_schema_mismatch"
  ));
});

test("la parité détecte une référence devenue orpheline dans SQLite", t => {
  const db = load(t);
  db.exec("PRAGMA foreign_keys = OFF");
  assert.equal(db.prepare("UPDATE household_charges SET household_id = 'FICT-absent'").run().changes, 1);
  db.exec("PRAGMA foreign_keys = ON");
  const report = verifySyntheticParity(db);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue => issue.reason === "sqlite_foreign_key_violation"));
});

test("la commande utilise le jeu fictif embarqué et refuse les arguments", () => {
  const good = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(good.status, 0, good.stderr);
  const report = JSON.parse(good.stdout);
  assert.equal(report.fixture, "synthetic");
  assert.equal(report.target, "sqlite-memory");
  assert.equal(report.tablesChecked, 36);

  const bad = spawnSync(process.execPath, [script, "other-data.sql"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, "");
});
