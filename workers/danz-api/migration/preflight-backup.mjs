/**
 * DANZ - preflight LOCAL strictement non intrusif.
 * Ne collecte pas les secrets, fichiers, donnees personnelles ou chemins.
 * Ne contacte ni Supabase, ni Cloudflare, ni une API et ne lance aucun dump.
 * Usage (depuis le depot) :
 *   node workers/danz-api/migration/preflight-backup.mjs
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COMMANDS = Object.freeze([
  ["node", ["--version"]],
  ["supabase", ["--version"]],
  ["docker", ["--version"]],
  ["pg_dump", ["--version"]],
  ["psql", ["--version"]],
  ["rclone", ["version"]],
]);

function defaultProbe(name, args) {
  try {
    const proc = spawnSync(name, args, {
      stdio: "ignore",
      env: { ...process.env, NO_COLOR: "1" },
      timeout: 5000,
      windowsHide: true,
    });
    return proc.status === 0 && !proc.error;
  } catch (_) {
    return false;
  }
}

export function inspectBackupPrerequisites(probe = defaultProbe) {
  const checks = COMMANDS.map(([tool, args]) => ({
    tool, available: Boolean(probe(tool, args)),
  }));
  const missing = checks.filter(item => !item.available).map(item => item.tool);
  return {
    stage: "local-backup-prerequisites",
    platform: process.platform,
    checks,
    toolsReady: missing.length === 0,
    // Un outil installe n'est PAS une sauvegarde verifiee.
    actualBackupCreated: false,
    storageEncryptedVerified: false,
    restoreVerified: false,
    realMigrationAuthorized: false,
    next: missing.length ? "install_missing_tools_on_authorized_machine" :
      "verify_encrypted_private_storage_and_approved_backup_method",
  };
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const result = inspectBackupPrerequisites();
  console.log(JSON.stringify(result, null, 2));
  if (!result.toolsReady) process.exitCode = 1;
}
