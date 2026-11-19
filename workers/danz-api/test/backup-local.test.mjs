import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
  writeFileSync(join(root,"data.sql"),[
    ...contract.tables.map(x=>`COPY public.${x.name} (id) FROM stdin;\n\\.\n`),
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
