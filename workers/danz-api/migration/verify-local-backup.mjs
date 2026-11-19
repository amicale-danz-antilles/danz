// Vérification locale d'une sauvegarde privée, hors ligne.
// Usage: node migration/verify-local-backup.mjs /chemin/vers/backup-prive
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDirectory, fingerprintFile, isAssetPath, walkBackupAssets } from "./backup-assets.mjs";
import { readPgCopy, readPublicDumpSchema } from "./read-pg-copy.mjs";

const contract = JSON.parse(readFileSync(new URL("./source-contract.json", import.meta.url), "utf8"));
const businessTables = new Map(contract.tables.map((table) => [table.name, table.primaryKey]));
const managedTables = ["auth.users", "storage.objects", "storage.buckets"];
const decoder = new TextDecoder("utf-8", { fatal: true });

function readBackupSql(root, filename, report, issue) {
  const filepath = join(root, filename);
  try {
    const stat = lstatSync(filepath, { throwIfNoEntry: false });
    if (!stat) {
      issue("missing_" + filename);
      return;
    }
    if (!stat.isFile() || stat.size === 0) {
      issue("empty_or_invalid_" + filename);
      return;
    }
    const bytes = readFileSync(filepath);
    const sql = decoder.decode(bytes);
    report.fileDigests[filename] = {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    return sql;
  } catch {
    issue("unreadable_" + filename);
  }
}

function validateSchema(sql, report, issue) {
  let schema;
  try {
    schema = readPublicDumpSchema(sql);
  } catch {
    issue("invalid_schema_sql");
    return;
  }
  for (const [table, expectedKey] of businessTables) {
    const actual = schema.get(table);
    if (!actual) {
      issue("missing_schema_table:" + table);
      continue;
    }
    report.checkedTables++;
    if (expectedKey.length !== actual.primaryKey.length ||
        expectedKey.some((name, index) => actual.primaryKey[index] !== name || !actual.columns.has(name))) {
      issue("schema_primary_key_mismatch:" + table);
    }
  }
  if ([...schema.keys()].some((table) => !businessTables.has(table))) issue("unexpected_schema_table");
  return schema;
}

function validateCopy(sql, schema, issue) {
  const seen = new Set();
  let keyPositions = [];
  let keys;

  readPgCopy(sql, {
    onIssue: issue,
    onBlock({ schema: namespace, table, columns }) {
      const qualified = `${namespace}.${table}`;
      seen.add(qualified);
      keyPositions = [];
      if (namespace !== "public") return;

      const primaryKey = businessTables.get(table);
      if (!primaryKey) {
        issue("unexpected_data_copy");
        return;
      }
      keyPositions = primaryKey.map((column) => columns.indexOf(column));
      keys = new Set();
      if (keyPositions.includes(-1)) {
        issue("missing_copy_primary_key:" + table);
        keyPositions = [];
      }

      const expected = schema?.get(table)?.copyColumns;
      if (expected && (columns.length !== expected.size || columns.some((column) => !expected.has(column)))) {
        issue("schema_copy_columns_mismatch:" + table);
      }
    },
    onRow({ table }, values) {
      if (!keyPositions.length) return;

      const fields = keyPositions.map((position) => values[position]);
      if (fields.includes(null)) {
        issue("null_primary_key:" + table);
        return;
      }

      const key = JSON.stringify(fields);
      if (keys.has(key)) issue("duplicate_primary_key:" + table);
      keys.add(key);
    },
  });

  for (const table of businessTables.keys()) {
    if (!seen.has("public." + table)) issue("missing_data_copy:" + table);
  }
  for (const table of managedTables) {
    if (!seen.has(table)) issue("missing_managed_data:" + table);
  }
}

function readManifest(root, requireAssets, issue) {
  const path = join(root, "assets-manifest.json");
  try {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) {
      if (requireAssets) issue("missing_assets_manifest");
      return;
    }
    if (!stat.isFile()) throw new Error("invalid_manifest_file");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed?.format !== "DANZ-ASSETS-1" || !Array.isArray(parsed.files)) {
      throw new Error("invalid_manifest_format");
    }

    if (!parsed.files.length && requireAssets) issue("empty_assets_manifest");
    const expected = new Map();
    for (const item of parsed.files) {
      if (!isAssetPath(item?.path) || expected.has(item.path) ||
          !Number.isSafeInteger(item.bytes) || item.bytes < 0 ||
          typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)) {
        issue("invalid_asset_entry");
        continue;
      }
      expected.set(item.path, item);
    }
    return expected;
  } catch {
    issue("invalid_assets_manifest");
  }
}

function validateAssets(root, expected, report, issue) {
  try {
    for (const { absolute, path } of walkBackupAssets(root)) {
      const item = expected.get(path);
      if (!item) {
        issue("unexpected_asset");
        continue;
      }
      expected.delete(path);
      try {
        const actual = fingerprintFile(absolute);
        if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256) {
          issue("file_mismatch");
        } else {
          report.checkedFiles++;
        }
      } catch {
        issue("unreadable_asset");
      }
    }
  } catch {
    issue("invalid_storage_tree");
  }
  if (expected.size) issue("missing_asset");
}

export function verifyLocalBackup(directory, { requireAssets = true } = {}) {
  const report = {
    ok: false,
    checkedTables: 0,
    expectedTables: businessTables.size,
    checkedFiles: 0,
    issues: [],
    fileDigests: {},
  };

  if (typeof directory !== "string" || !directory) {
    report.issues.push("missing_backup_folder");
    return report;
  }
  const root = resolve(directory);
  try {
    assertDirectory(root);
  } catch {
    report.issues.push("invalid_backup_folder");
    return report;
  }

  const issues = new Set();
  const issue = (code) => issues.add(code);
  readBackupSql(root, "roles.sql", report, issue);
  const schemaSql = readBackupSql(root, "schema.sql", report, issue);
  const schema = schemaSql && validateSchema(schemaSql, report, issue);
  const dataSql = readBackupSql(root, "data.sql", report, issue);
  if (dataSql) validateCopy(dataSql, schema, issue);
  const expectedAssets = readManifest(root, requireAssets, issue);
  if (expectedAssets) validateAssets(root, expectedAssets, report, issue);

  report.issues = [...issues];
  report.ok = issues.size === 0 && report.checkedTables === businessTables.size;
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2];
  if (!directory) {
    console.error("Usage: node migration/verify-local-backup.mjs /private-backup-directory");
    process.exitCode = 2;
  } else {
    const { fileDigests, ...summary } = verifyLocalBackup(directory);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) process.exitCode = 1;
  }
}
