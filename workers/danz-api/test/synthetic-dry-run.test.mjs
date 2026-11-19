import test from "node:test";
import assert from "node:assert/strict";
import { createSyntheticFixture, encodeSyntheticCopy, syntheticTables } from "../migration/synthetic-fixtures.mjs";
import { parseSyntheticCopy, openSyntheticDatabase, importSyntheticCopy, readSyntheticSnapshot, runSyntheticDryRun, syntheticFinanceCheck } from "../migration/synthetic-dry-run.mjs";
import { compareSnapshots } from "../migration/compare-snapshots.mjs";

function opened() {
  const fixture = createSyntheticFixture(), db = openSyntheticDatabase();
  importSyntheticCopy(db, fixture.dump, fixture.snapshot.authAccounts);
  return { fixture, db };
}

test("synthetic COPY round-trip covers 36 tables, five composite keys and exact cents", () => {
  const result = runSyntheticDryRun();
  assert.equal(result.ok, true);
  assert.equal(result.tablesChecked, 36);
  assert.equal(result.compositePrimaryKeys, 5);
  assert.equal(result.syntheticRows, 70);
  assert.equal(result.parity.areasChecked, 38);
  assert.deepEqual(result.finance, { ok: true, bankCents: 18500, cashCents: 3500, totalCents: 22000 });
  assert.equal(result.productionReadiness, "NO-GO");
  assert.equal(result.realBackupVerified, false);
  assert.equal(result.edgeFunctionsInventoried, 9);
  assert.equal(result.edgeFunctionBehaviorVerified, false);
});

test("COPY escaping retains UTF-8, tabs, newlines, literal backslash-N and NULL", () => {
  const fixture = createSyntheticFixture(), parsed = parseSyntheticCopy(fixture.dump);
  assert.deepEqual(parsed, fixture.snapshot.tables);
  assert.equal(parsed.profiles[0].optional_note, null);
  assert.equal(parsed.profiles[1].optional_note, "\\N");
});

test("an empty table needs its COPY block and composite keys retain both parts", () => {
  const fixture = createSyntheticFixture(), db = openSyntheticDatabase();
  fixture.snapshot.tables.news = [];
  fixture.snapshot.tables.poll_votes.push({ ...fixture.snapshot.tables.poll_votes[0], user_id: fixture.snapshot.tables.profiles[1].id });
  try {
    importSyntheticCopy(db, encodeSyntheticCopy(fixture.snapshot.tables), fixture.snapshot.authAccounts);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM news").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM poll_votes").get().n, 3);
    assert.equal(compareSnapshots(fixture.snapshot, readSyntheticSnapshot(db, fixture.objects)).ok, true);
  } finally { db.close(); }
});

test("independent SQLite read catches a missing row and a single cent", () => {
  const { fixture, db } = opened();
  try {
    db.prepare("DELETE FROM documents WHERE id = ?").run(fixture.snapshot.tables.documents[0].id);
    db.exec("UPDATE treasury_entries SET amount_cents=amount_cents+1 WHERE kind='expense'");
    const result = compareSnapshots(fixture.snapshot, readSyntheticSnapshot(db, fixture.objects));
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(i => i.area === "table:documents" && i.missing === 1));
    assert.ok(result.issues.some(i => i.area === "table:treasury_entries" && i.changed === 1));
    assert.equal(syntheticFinanceCheck(db).ok, false);
  } finally { db.close(); }
});

test("duplicate composite key rejects the whole import atomically", () => {
  const fixture = createSyntheticFixture(), db = openSyntheticDatabase();
  fixture.snapshot.tables.poll_votes.push({ ...fixture.snapshot.tables.poll_votes[0] });
  try {
    assert.throws(() => importSyntheticCopy(db, encodeSyntheticCopy(fixture.snapshot.tables), fixture.snapshot.authAccounts), /synthetic_import_rejected/);
    for (const table of syntheticTables) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "${table.name}"`).get().n, 0);
  } finally { db.close(); }
});

test("broken foreign key rejects import and restores an empty database", () => {
  const fixture = createSyntheticFixture(), db = openSyntheticDatabase();
  fixture.snapshot.tables.household_payments[0].household_id = "SYNTHETIC-NO-SUCH-HOUSEHOLD";
  try {
    assert.throws(() => importSyntheticCopy(db, encodeSyntheticCopy(fixture.snapshot.tables), fixture.snapshot.authAccounts), /synthetic_import_rejected/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM households").get().n, 0);
  } finally { db.close(); }
});

test("missing COPY, repeated COPY, truncation and mismatched columns fail closed", () => {
  const fixture = createSyntheticFixture();
  const withoutDocuments = fixture.dump.replace(/COPY public\.documents[^\n]*\n[\s\S]*?\\\.\n/, "");
  assert.throws(() => parseSyntheticCopy(withoutDocuments), /required_synthetic_copy_missing/);
  assert.throws(() => parseSyntheticCopy(fixture.dump.replace("FROM stdin;", "FROM '/private/file';")), /invalid_synthetic_copy_statement/);
  assert.throws(() => parseSyntheticCopy(fixture.dump.replace("(id, synthetic_note", "(unexpected, synthetic_note")), /synthetic_columns_mismatch/);
  assert.throws(() => parseSyntheticCopy(fixture.dump.slice(0, -3)), /unterminated_synthetic_copy|column_count_mismatch/);
  assert.throws(() => parseSyntheticCopy(fixture.dump + fixture.dump.split("\n").slice(1).join("\n")), /unknown_or_duplicate_synthetic_table/);
});

test("unsafe integers and arbitrary SQL are never executed", () => {
  const fixture = createSyntheticFixture();
  assert.throws(() => parseSyntheticCopy(fixture.dump.replace("\t12345\t", "\t9007199254740993\t")), /unsafe_synthetic_integer/);
  assert.throws(() => parseSyntheticCopy("-- DANZ-SYNTHETIC-COPY-1\nDROP TABLE households;\n"), /invalid_synthetic_copy_statement/);
  assert.throws(() => parseSyntheticCopy(fixture.dump.replace("FICTIF", "FICTIF\\x")), /unsupported_synthetic_copy_escape/);
});

test("identity privileges and copied file bytes are checked independently", () => {
  const { fixture, db } = opened();
  try {
    db.exec("UPDATE synthetic_identity_manifest SET is_treasurer=0 WHERE role='admin'");
    const copiedObjects = new Map([...fixture.objects].map(([key, bytes]) => [key, Buffer.from(bytes)]));
    const key = copiedObjects.keys().next().value;
    copiedObjects.set(key, copiedObjects.get(key).subarray(1));
    const result = compareSnapshots(fixture.snapshot, readSyntheticSnapshot(db, copiedObjects));
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(i => i.area === "authAccounts" && i.changed === 1));
    assert.ok(result.issues.some(i => i.area === "files" && i.changed === 1));
  } finally { db.close(); }
});

test("matching row counts do not hide altered household allocation", () => {
  const { db } = opened();
  try {
    db.exec("UPDATE household_payment_allocations SET amount_cents=amount_cents+1");
    assert.equal(syntheticFinanceCheck(db).ok, false);
  } finally { db.close(); }
});
