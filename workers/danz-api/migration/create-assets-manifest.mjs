// Inventaire SHA-256 privé des fichiers téléchargés, hors ligne.
// Usage: node migration/create-assets-manifest.mjs <private-backup-directory>
import { lstatSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDirectory, fingerprintFile, walkBackupAssets } from "./backup-assets.mjs";

export async function createManifest(directory) {
  const root = resolve(directory);
  assertDirectory(root);
  const files = [];
  for (const { absolute, path } of walkBackupAssets(root)) {
    files.push({ path, ...fingerprintFile(absolute) });
  }
  if (files.length === 0) throw new Error("no_files_in_storage_backup");
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { format: "DANZ-ASSETS-1", files };
}

function saveManifest(root, manifest) {
  const destination = join(root, "assets-manifest.json");
  const existing = lstatSync(destination, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) throw new Error("invalid_manifest_destination");

  const temporaryDirectory = mkdtempSync(join(root, ".assets-manifest-"));
  try {
    const temporaryFile = join(temporaryDirectory, "manifest.json");
    writeFileSync(temporaryFile, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporaryFile, destination);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error("Usage: node migration/create-assets-manifest.mjs <private-directory>");
    process.exitCode = 2;
  } else {
    try {
      const root = resolve(process.argv[2]);
      const manifest = await createManifest(root);
      saveManifest(root, manifest);
      console.log(JSON.stringify({ ok: true, filesHashed: manifest.files.length, manifest: "assets-manifest.json" }));
    } catch {
      console.error("Cannot build private file manifest; verify storage copies and permissions");
      process.exitCode = 1;
    }
  }
}
