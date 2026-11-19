// Rejoue exclusivement les fichiers fictifs versionnés. Aucun chemin ni DSN en argument.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { compareSnapshots } from "./compare-snapshots.mjs";

const image = "postgres@sha256:526f86d93c6ea08fd3f1fe5605650cacc781b2c6013169a0ad8f42c7d3d84f32";
const fixture = name => readFileSync(new URL(`./fixtures/phase-1/${name}`, import.meta.url), "utf8");
const contract = JSON.parse(readFileSync(new URL("./source-contract.json", import.meta.url), "utf8"));

function verificationQuery() {
  const entries = contract.tables.map(({ name }) => {
    if (!/^[a-z][a-z_0-9]*$/.test(name)) throw new Error("invalid_contract_table");
    return `'${name}', COALESCE((SELECT json_agg(t) FROM public."${name}" AS t), '[]'::json)`;
  });
  return `SELECT json_build_object('tables', json_build_object(${entries.join(", ")}), 'primaryKeys', (
    SELECT json_object_agg(table_name, columns)
    FROM (
      SELECT t.relname AS table_name, json_agg(a.attname ORDER BY cols.ordinality) AS columns
      FROM pg_constraint AS c
      JOIN pg_class AS t ON t.oid = c.conrelid
      JOIN pg_namespace AS n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
      JOIN pg_attribute AS a ON a.attrelid = t.oid AND a.attnum = cols.attnum
      WHERE n.nspname = 'public' AND c.contype = 'p'
      GROUP BY t.relname
    ) AS pks
  ));`;
}

function restore() {
  const sql = [fixture("schema.sql"), fixture("data.sql"), verificationQuery()].join("\n");
  const result = spawnSync("docker", [
    "run", "--rm", "--interactive", "--network", "none", "--pull", "never",
    "--user", "postgres", image, "sh", "-eu", "-c", `
      base=$(mktemp -d)
      initdb -D "$base/db" --locale=C --encoding=UTF8 --auth=trust >/dev/null
      pg_ctl -D "$base/db" -l "$base/postgres.log" -o "-c listen_addresses='' -k $base" -w start >/dev/null
      export PGOPTIONS='-c statement_timeout=15000'
      psql -X -h "$base" -U postgres -d postgres -v ON_ERROR_STOP=1 \\
        --quiet --tuples-only --no-align --single-transaction --file=-
    `,
  ], { input: sql, encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("synthetic_postgres_restore_failed");
  return JSON.parse(result.stdout);
}

function checkRestoration() {
  const { tables, primaryKeys } = restore();
  const expectedKeys = Object.fromEntries(contract.tables.map(({ name, primaryKey }) => [name, primaryKey]));
  if (!primaryKeys || Object.keys(primaryKeys).length !== contract.tables.length
    || Object.entries(expectedKeys).some(([name, fields]) => JSON.stringify(fields) !== JSON.stringify(primaryKeys[name]))) {
    throw new Error("synthetic_postgres_primary_key_mismatch");
  }
  const snapshot = tables => ({ format: "DANZ-PRIVATE-1", tables, authAccounts: [], assets: [] });
  const expected = JSON.parse(fixture("expected-tables.json"));
  const parity = compareSnapshots(snapshot(expected), snapshot(tables));
  return { ok: parity.ok, tablesChecked: parity.areasChecked - 2, issues: parity.issues };
}

if (process.argv.length !== 2) {
  console.error("Usage: node migration/restore-synthetic-postgres.mjs");
  process.exitCode = 2;
} else {
  try {
    const result = checkRestoration();
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error("Échec de la restauration PostgreSQL fictive. Vérifier Docker, l’image locale et les fixtures versionnées.");
    process.exitCode = 1;
  }
}
