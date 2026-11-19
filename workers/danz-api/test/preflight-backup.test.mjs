import test from "node:test";
import assert from "node:assert/strict";
import { inspectBackupPrerequisites } from "../migration/preflight-backup.mjs";

const expected = ["node", "supabase", "docker", "pg_dump", "psql", "rclone"];

test("preflight: logiciel disponible ne signifie ni sauvegarde ni migration", () => {
  const seen = [];
  const result = inspectBackupPrerequisites((name, args) => {
    seen.push({name,args});
    return true;
  });
  assert.deepEqual(result.checks.map(item => item.tool), expected);
  assert.equal(seen.length, expected.length);
  assert.equal(result.toolsReady, true);
  assert.equal(result.actualBackupCreated, false);
  assert.equal(result.storageEncryptedVerified, false);
  assert.equal(result.restoreVerified, false);
  assert.equal(result.realMigrationAuthorized, false);
  assert.ok(!JSON.stringify(result).includes("password"));
});

test("preflight: une dependance absente est signalee sans exposition de chemin", () => {
  const result = inspectBackupPrerequisites(name => name !== "rclone");
  assert.equal(result.toolsReady, false);
  assert.deepEqual(result.checks.filter(item => !item.available).map(x => x.tool), ["rclone"]);
  assert.equal(result.next, "install_missing_tools_on_authorized_machine");
});

test("preflight: sortie limitee a des indicateurs non confidentiels", () => {
  const result = inspectBackupPrerequisites(() => false);
  assert.equal(result.checks.length, 6);
  assert.deepEqual(new Set(Object.keys(result)), new Set([
    "stage","platform","checks","toolsReady","actualBackupCreated",
    "storageEncryptedVerified","restoreVerified","realMigrationAuthorized","next",
  ]));
});
