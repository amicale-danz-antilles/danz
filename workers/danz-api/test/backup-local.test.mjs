import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createManifest } from "../migration/create-assets-manifest.mjs";
import { verifyLocalBackup } from "../migration/verify-local-backup.mjs";
import { readPgCopy } from "../migration/read-pg-copy.mjs";

const contract=JSON.parse(readFileSync(new URL("../migration/source-contract.json",import.meta.url),"utf8"));
const createTable = ({ name, primaryKey }) =>
  `CREATE TABLE public.${name} (${primaryKey.map((name) => `${name} text`).join(", ")});\n`;
const addPrimaryKey = ({ name, primaryKey }) =>
  `ALTER TABLE ONLY public.${name} ADD CONSTRAINT ${name}_pkey PRIMARY KEY (${primaryKey.join(", ")});\n`;
const copyBlock = ({ name, primaryKey }) =>
  `COPY public.${name} (${primaryKey.join(", ")}) FROM stdin;\n\\.\n`;

function fixture(){
  const root=mkdtempSync(join(tmpdir(),"danz-backup-fake-"));
  mkdirSync(join(root,"r2","test-bucket"),{recursive:true});
  mkdirSync(join(root,"supabase-storage","test-bucket"),{recursive:true});
  writeFileSync(join(root,"r2","test-bucket","fake-a.txt"),"fictitious R2 object");
  writeFileSync(join(root,"supabase-storage","test-bucket","fake-b.txt"),"fictitious Storage object");
  writeFileSync(join(root,"roles.sql"),"-- fake roles SQL");
  writeFileSync(join(root,"schema.sql"),contract.tables.map(createTable).join("") +
    contract.tables.map(addPrimaryKey).join(""));
  writeFileSync(join(root,"data.sql"),[
    ...contract.tables.map(copyBlock),
    "COPY auth.users (id) FROM stdin;\n\\.\n",
    "COPY storage.objects (id) FROM stdin;\n\\.\n",
    "COPY storage.buckets (id) FROM stdin;\n\\.\n",
  ].join(""));
  return root;
}

test("tous les 36 schémas et 39 blocs de donnees + fichiers SHA256 valident la copie locale fictive",async()=>{
  const root=fixture();
  try{
    const manifest=await createManifest(root);
    assert.equal(manifest.format,"DANZ-ASSETS-1");
    assert.equal(manifest.files.length,2);
    writeFileSync(join(root,"assets-manifest.json"),JSON.stringify(manifest));
    const report=verifyLocalBackup(root);
    assert.equal(report.ok,true,JSON.stringify(report.issues));
    assert.equal(report.checkedTables,36);
    assert.equal(report.checkedFiles,2);
    assert.ok(report.fileDigests["data.sql"].sha256);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("bloc auth.users absent : refuse la sauvegarde incomplète",async()=>{
  const root=fixture();
  try{
    writeFileSync(join(root,"assets-manifest.json"),JSON.stringify(await createManifest(root)));
    let content=readFileSync(join(root,"data.sql"),"utf8");
    content=content.replace("COPY auth.users (id) FROM stdin;\n\\.\n","");
    writeFileSync(join(root,"data.sql"),content);
    const report=verifyLocalBackup(root);
    assert.equal(report.ok,false);
    assert.ok(report.issues.includes("missing_managed_data:auth.users"));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("ligne schema ou table metier disparue: refuse la sauvegarde",async()=>{
  const root=fixture();
  try{
    writeFileSync(join(root,"assets-manifest.json"),JSON.stringify(await createManifest(root)));
    writeFileSync(join(root,"schema.sql"),readFileSync(join(root,"schema.sql"),"utf8")
      .replace("CREATE TABLE public.treasury_entries (id text);\n",""));
    const report=verifyLocalBackup(root);
    assert.equal(report.ok,false);
    assert.ok(report.issues.includes("missing_schema_table:treasury_entries"));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("fichier local endommage: le SHA256 refuse la sauvegarde",async()=>{
  const root=fixture();
  try{
    writeFileSync(join(root,"assets-manifest.json"),JSON.stringify(await createManifest(root)));
    writeFileSync(join(root,"r2","test-bucket","fake-a.txt"),"modified after SHA");
    const report=verifyLocalBackup(root);
    assert.equal(report.ok,false);
    assert.ok(report.issues.includes("file_mismatch"));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("absence de manifeste binaire: validation interdite",()=>{
  const root=fixture();
  try{
    const report=verifyLocalBackup(root);
    assert.equal(report.ok,false);
    assert.ok(report.issues.includes("missing_assets_manifest"));
  }finally{rmSync(root,{recursive:true,force:true});}
});

async function fixtureWithManifest(t) {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = await createManifest(root);
  writeFileSync(join(root, "assets-manifest.json"), JSON.stringify(manifest));
  return { root, manifest };
}

function rewrite(root, name, change) {
  const path = join(root, name);
  const original = readFileSync(path, "utf8");
  const altered = change(original);
  assert.notEqual(altered, original);
  writeFileSync(path, altered);
}

function refuses(root, code) {
  const report = verifyLocalBackup(root);
  assert.equal(report.ok, false);
  assert.ok(report.issues.includes(code), JSON.stringify(report.issues));
  return report;
}

test("absence de COPY d’une table métier même vide", async (t) => {
  const { root } = await fixtureWithManifest(t);
  const table = contract.tables.find(({ name }) => name === "treasury_entries");
  rewrite(root, "data.sql", (sql) => sql.replace(copyBlock(table), ""));
  refuses(root, "missing_data_copy:treasury_entries");
});

test("bloc COPY tronqué après une ligne fictive", async (t) => {
  const { root } = await fixtureWithManifest(t);
  rewrite(root, "data.sql", (sql) => sql.replace(
    "COPY storage.buckets (id) FROM stdin;\n\\.\n",
    "COPY storage.buckets (id) FROM stdin;\nbucket-fictif\n",
  ));
  refuses(root, "missing_copy_terminator");
});

test("lignes COPY ambiguës et blocs répétés", async (t) => {
  const { root } = await fixtureWithManifest(t);
  rewrite(root, "data.sql", (sql) => sql +
    "COPY public.treasury_entries (id) FROM stdin;\nfake-id\textra-field\n\\.\n");
  const report = refuses(root, "duplicate_copy_block");
  assert.ok(report.issues.includes("invalid_copy_row_width"));
});

test("détection des clés composées manquantes et dupliquées", async (t) => {
  const { root } = await fixtureWithManifest(t);
  const table = contract.tables.find(({ name }) => name === "household_payment_allocations");
  const block = copyBlock(table);
  rewrite(root, "data.sql", (sql) => sql.replace(block, block.replace("\\.\n",
    "fake-payment\tfake-charge\nfake-payment\tfake-charge-2\nfake-payment\tfake-charge\n\\N\tfake-charge-3\n\\.\n")));
  const report = refuses(root, "duplicate_primary_key:household_payment_allocations");
  assert.ok(report.issues.includes("null_primary_key:household_payment_allocations"));
  assert.doesNotMatch(JSON.stringify(report), /fake-payment|fake-charge/);
});

test("l’ordre des clés primaires composites est contrôlé", async (t) => {
  const { root } = await fixtureWithManifest(t);
  rewrite(root, "schema.sql", (sql) => sql.replace(
    "PRIMARY KEY (payment_id, charge_id)", "PRIMARY KEY (charge_id, payment_id)",
  ));
  refuses(root, "schema_primary_key_mismatch:household_payment_allocations");
});

test("un COPY sans colonne exportable déclarée ne valide pas le schéma", async (t) => {
  const { root } = await fixtureWithManifest(t);
  rewrite(root, "schema.sql", (sql) => sql.replace(
    "CREATE TABLE public.treasury_entries (id text);",
    "CREATE TABLE public.treasury_entries (id text, amount_cents integer);",
  ));
  refuses(root, "schema_copy_columns_mismatch:treasury_entries");
});

test("les déclarations citées dans le corps d’une fonction ne comptent pas", async (t) => {
  const { root } = await fixtureWithManifest(t);
  const table = contract.tables.find(({ name }) => name === "treasury_entries");
  rewrite(root, "schema.sql", (sql) => sql.replace(createTable(table),
    "CREATE FUNCTION fictive() RETURNS text LANGUAGE sql AS $f$\n" +
    "SELECT $text$\n" + createTable(table) + "$text$;\n$f$;\n"));
  refuses(root, "missing_schema_table:treasury_entries");
});

test("les guillemets PostgreSQL, clés en ligne et colonnes calculées sont compris", async (t) => {
  const { root } = await fixtureWithManifest(t);
  const table = contract.tables.find(({ name }) => name === "treasury_entries");
  rewrite(root, "schema.sql", (sql) => sql.replace(createTable(table),
    '  CREATE TABLE IF NOT EXISTS "public"."treasury_entries" (\n' +
    '    "id" text primary key,\n' +
    "    display_id text GENERATED ALWAYS AS (concat('fictif, ', id)) STORED\n" +
    ");\n").replace(addPrimaryKey(table), ""));
  rewrite(root, "data.sql", (sql) => sql.replace(copyBlock(table),
    '  COPY "public"."treasury_entries" ("id") FROM stdin;\nfactice\n\\.\n'));
  const report = verifyLocalBackup(root);
  assert.equal(report.ok, true, JSON.stringify(report.issues));
});

test("les échappements PG COPY texte sont décodés sans perdre le NULL", () => {
  const rows = [];
  const sql = [
    "-- En-tête pg_dump fictif",
    "\\restrict Test1234",
    "SET client_encoding = 'UTF8';",
    'COPY "public"."fictive" (id, "data", z) FROM stdin;',
    "synthetic-01\t\\303\\251\\ttexte\\nline\t\\N",
    "synthetic-02\t\\\\N\t",
    "\\.",
    "\\unrestrict Test1234",
    "RESET ALL;",
  ].join("\r\n");
  readPgCopy(sql, { onRow: (_, values) => rows.push(values) });
  assert.deepEqual(rows, [
    ["synthetic-01", "é\ttexte\nline", null],
    ["synthetic-02", "\\N", ""],
  ]);
});

test("fichier inventorié absent et fichier ajouté depuis l’inventaire", async (t) => {
  const { root } = await fixtureWithManifest(t);
  rmSync(join(root, "r2", "test-bucket", "fake-a.txt"));
  writeFileSync(join(root, "r2", "test-bucket", "fake-c.txt"), "extra fictitious object");
  const report = refuses(root, "missing_asset");
  assert.ok(report.issues.includes("unexpected_asset"));
  assert.doesNotMatch(JSON.stringify(report), /fake-[ac]\.txt/);
});

test("empreinte fausse malgré une taille correcte", async (t) => {
  const { root, manifest } = await fixtureWithManifest(t);
  manifest.files[0].sha256 = "0".repeat(64);
  writeFileSync(join(root, "assets-manifest.json"), JSON.stringify(manifest));
  refuses(root, "file_mismatch");
});

test("chemins aliasés dans le manifeste", async (t) => {
  const { root, manifest } = await fixtureWithManifest(t);
  manifest.files[0].path = manifest.files[0].path.replace("/test-bucket/", "/./test-bucket/");
  writeFileSync(join(root, "assets-manifest.json"), JSON.stringify(manifest));
  refuses(root, "invalid_asset_entry");
});

test("un répertoire de stockage symbolique est refusé", { skip: process.platform === "win32" }, async (t) => {
  const { root } = await fixtureWithManifest(t);
  rmSync(join(root, "r2"), { recursive: true });
  symlinkSync(join(root, "supabase-storage"), join(root, "r2"), "dir");
  await assert.rejects(createManifest(root), /invalid_backup_directory/);
  refuses(root, "invalid_storage_tree");
});
