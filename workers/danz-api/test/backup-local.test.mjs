import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { createManifest } from "../migration/create-assets-manifest.mjs";
import { verifyLocalBackup } from "../migration/verify-local-backup.mjs";

const contract=JSON.parse(readFileSync(new URL("../migration/source-contract.json",import.meta.url),"utf8"));
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"danz-backup-fake-"));
  mkdirSync(join(root,"r2","test-bucket"),{recursive:true});
  mkdirSync(join(root,"supabase-storage","test-bucket"),{recursive:true});
  writeFileSync(join(root,"r2","test-bucket","fake-a.txt"),"fictitious R2 object");
  writeFileSync(join(root,"supabase-storage","test-bucket","fake-b.txt"),"fictitious Storage object");
  writeFileSync(join(root,"roles.sql"),"-- fake roles SQL");
  writeFileSync(join(root,"schema.sql"),contract.tables.map(x=>`CREATE TABLE public.${x.name} (id text);\n`).join(""));
  // Simuler un dump Supabase CLI (public) + un export PostgreSQL prive
  // distinct des schemas manages auth et storage.
  writeFileSync(join(root,"data.sql"),
    contract.tables.map(x=>`COPY public.${x.name} (${x.primaryKey.join(", ")}) FROM stdin;\n\\.\n`).join(""));
  writeFileSync(join(root,"managed-data.sql"),[
    "COPY auth.users (id) FROM stdin;\n\\.\n",
    "COPY auth.identities (id, user_id) FROM stdin;\n\\.\n",
    "COPY storage.objects (id) FROM stdin;\n\\.\n",
    "COPY storage.buckets (id) FROM stdin;\n\\.\n",
  ].join(""));
  return root;
}

test("tous les 36 schémas et 40 blocs de donnees + fichiers SHA256 valident la copie locale fictive",async()=>{
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
    assert.equal(report.restorationVerified,false);
    assert.equal(report.encryptionVerified,false);
    assert.equal(report.remoteInventoryVerified,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("la sauvegarde CLI sans export de schemas geres ne peut pas etre validee", async()=>{
  await withBackup(root=>rmSync(join(root,"managed-data.sql")),
    report=>assert.ok(report.issues.includes("missing_managed_data:auth.users")
      && report.issues.includes("missing_managed_data:storage.objects")));
});

test("bloc auth.users absent : refuse la sauvegarde incomplète",async()=>{
  const root=fixture();
  try{
    writeFileSync(join(root,"assets-manifest.json"),JSON.stringify(await createManifest(root)));
    let content=readFileSync(join(root,"managed-data.sql"),"utf8");
    content=content.replace("COPY auth.users (id) FROM stdin;\n\\.\n","");
    writeFileSync(join(root,"managed-data.sql"),content);
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

async function withBackup(change,check) {
  const root=fixture();
  try {
    writeFileSync(join(root,"assets-manifest.json"),JSON.stringify(await createManifest(root)));
    change(root);
    const report=verifyLocalBackup(root);
    assert.equal(report.ok,false);
    check(report);
  } finally { rmSync(root,{recursive:true,force:true}); }
}

test("COPY tronqué ou dupliqué et ligne à colonnes manquantes bloquent la validation",async()=>{
  for (const [mutation,issue] of [
    [s=>s.replace(/\\\.\n$/, ""),"unterminated_copy_block"],
    [s=>s+"COPY public.profiles (id) FROM stdin;\n\\.\n","duplicate_copy_block"],
    [s=>s.replace("COPY public.profiles (id) FROM stdin;\n", "COPY public.profiles (id) FROM stdin;\nsynthetic-one\tsynthetic-two\n"),"invalid_copy_row_width"],
  ]) {
    await withBackup(root=>writeFileSync(join(root,"data.sql"),mutation(readFileSync(join(root,"data.sql"),"utf8"))),
      report=>assert.ok(report.issues.includes(issue)));
  }
});

test("COPY sans clé composée et identités absentes sont refusés",async()=>{
  await withBackup(root=>writeFileSync(join(root,"data.sql"),readFileSync(join(root,"data.sql"),"utf8")
    .replace("COPY public.poll_votes (poll_id, user_id)","COPY public.poll_votes (poll_id)")),
    report=>assert.ok(report.issues.includes("missing_copy_primary_key:poll_votes")));
  await withBackup(root=>writeFileSync(join(root,"managed-data.sql"),readFileSync(join(root,"managed-data.sql"),"utf8")
    .replace("COPY auth.identities (id, user_id) FROM stdin;\n\\.\n","")),
    report=>assert.ok(report.issues.includes("missing_managed_data:auth.identities")));
});

test("déclarations SQL dans un commentaire ou une fonction ne prouvent aucune sauvegarde",async()=>{
  await withBackup(root=>writeFileSync(join(root,"schema.sql"),readFileSync(join(root,"schema.sql"),"utf8")
    .replace("CREATE TABLE public.profiles (id text);", "/*\nCREATE TABLE public.profiles (id text);\n*/")),
    report=>assert.ok(report.issues.includes("missing_schema_table:profiles")));
  await withBackup(root=>writeFileSync(join(root,"schema.sql"),readFileSync(join(root,"schema.sql"),"utf8")
    .replace("CREATE TABLE public.profiles (id text);", "DO $body$\nCREATE TABLE public.profiles (id text);\n$body$;")),
    report=>assert.ok(report.issues.includes("missing_schema_table:profiles")));
  await withBackup(root=>writeFileSync(join(root,"data.sql"),readFileSync(join(root,"data.sql"),"utf8")
    .replace("COPY public.profiles (id) FROM stdin;\n\\.\n", "/*\nCOPY public.profiles (id) FROM stdin;\n*/")),
    report=>assert.ok(report.issues.includes("missing_data_copy:profiles")));
});

test("fichier non inventorié ou supprimé refuse le contrôle local",async()=>{
  await withBackup(root=>writeFileSync(join(root,"r2","test-bucket","not-in-manifest.txt"),"synthetic only"),
    report=>assert.ok(report.issues.includes("unmanifested_asset")));
  await withBackup(root=>rmSync(join(root,"r2","test-bucket","fake-a.txt")),
    report=>assert.ok(report.issues.includes("unreadable_asset")));
});

test("racines de stockage et objets symboliques sont refusés sans suivre les liens",async()=>{
  const root=fixture();
  try {
    writeFileSync(join(root,"assets-manifest.json"),JSON.stringify(await createManifest(root)));
    const bucket=join(root,"r2","test-bucket");
    rmSync(bucket,{recursive:true});
    symlinkSync(join(root,"supabase-storage","test-bucket"),bucket,"dir");
    assert.equal(verifyLocalBackup(root).ok,false);
    await assert.rejects(createManifest(root),/symlinks_not_allowed/);
    rmSync(join(root,"r2"),{recursive:true});
    symlinkSync(join(root,"supabase-storage"),join(root,"r2"),"dir");
    await assert.rejects(createManifest(root),/unsafe_storage_directory/);
    assert.equal(verifyLocalBackup(root).ok,false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("aucun chemin ou contenu privé ne paraît dans les erreurs du vérificateur",async()=>{
  await withBackup(root=>{
    const manifest=JSON.parse(readFileSync(join(root,"assets-manifest.json"),"utf8"));
    manifest.files[0].path="r2/private-sensitive-object.txt";
    writeFileSync(join(root,"assets-manifest.json"),JSON.stringify(manifest));
  },report=>assert.doesNotMatch(JSON.stringify(report),/private-sensitive-object|fictitious R2 object/));
});

test("une corruption de même taille échoue par SHA256, indépendamment de la taille",async()=>{
  await withBackup(root=>writeFileSync(join(root,"r2","test-bucket","fake-a.txt"),"Fictitious R2 object"),
    report=>assert.ok(report.issues.includes("file_mismatch")));
});

test("table sans COPY et chemin de manifeste sortant du stockage sont refusés",async()=>{
  await withBackup(root=>writeFileSync(join(root,"data.sql"),readFileSync(join(root,"data.sql"),"utf8")
    .replace("COPY public.treasury_entries (id) FROM stdin;\n\\.\n","")),
    report=>assert.ok(report.issues.includes("missing_data_copy:treasury_entries")));
  await withBackup(root=>{
    const manifest=JSON.parse(readFileSync(join(root,"assets-manifest.json"),"utf8"));
    manifest.files[0].path="r2/../../outside.txt";
    writeFileSync(join(root,"assets-manifest.json"),JSON.stringify(manifest));
  },report=>assert.ok(report.issues.includes("invalid_asset_entry")));
});
