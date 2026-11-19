import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";

const storages = ["r2", "supabase-storage"];

export function isAssetPath(path) {
  if (typeof path !== "string" || path.includes("\\") || path.includes("\0")) return false;
  const [storage, ...parts] = path.split("/");
  return storages.includes(storage) && parts.length > 0 &&
    parts.every((part) => part && part !== "." && part !== "..");
}

export function assertDirectory(directory) {
  if (!lstatSync(directory).isDirectory()) throw new Error("invalid_backup_directory");
}

export function* walkBackupAssets(root) {
  function* walk(directory, prefix) {
    assertDirectory(directory);
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const path = `${prefix}/${name}`;
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        yield* walk(absolute, path);
      } else if (stat.isFile() && isAssetPath(path)) {
        yield { absolute, path };
      } else {
        throw new Error("unsupported_asset_path");
      }
    }
  }

  for (const storage of storages) yield* walk(join(root, storage), storage);
}

export function fingerprintFile(path) {
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("invalid_asset_file");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0;
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
      bytes += count;
    }
    const after = fstatSync(fd);
    if (bytes !== stat.size || after.size !== bytes || after.mtimeMs !== stat.mtimeMs) {
      throw new Error("asset_changed_during_read");
    }
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    closeSync(fd);
  }
}
