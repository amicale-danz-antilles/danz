import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { generateD1Blueprint } from "../migration/generate-d1-blueprint.mjs";

const metadata=JSON.parse(readFileSync(new URL("../migration/source-schema-metadata.json",import.meta.url),"utf8"));
const clone=x=>structuredClone(x);

test("l'inventaire couvre 36 tables, 406 colonnes et 89 relations",()=>{
  assert.equal(metadata.tables.length,36);
  assert.equal(metadata.tables.reduce((n,t)=>n+t.columns.length,0),406);
  assert.equal(metadata.tables.reduce((n,t)=>n+t.foreignKeys.length,0),89);
  assert.equal(metadata.tables.filter(t=>t.sourceRlsEnabled).length,36);
  assert.equal(metadata.tables.reduce((n,t)=>n+t.constraintsNotModeled.checks,0),73);
  assert.equal(metadata.tables.reduce((n,t)=>n+t.constraintsNotModeled.uniques,0),10);
  assert.equal(metadata.tables.reduce((n,t)=>n+t.uniqueKeys.length,0),10);
});

test("le plan SQLite s'exécute en mémoire sans écrire dans Cloudflare",()=>{
  const generated=generateD1Blueprint();
  assert.equal(generated.tableCount,36);
  assert.equal(generated.columnCount,406);
  assert.equal(generated.realDataIncluded,false);
  assert.equal(generated.safeForRemoteImport,false);
  assert.equal(generated.approval,"NO-GO");
  assert.ok(generated.risks.some(x=>x.kind==="check_constraints"));
  assert.ok(!generated.risks.some(x=>x.kind==="unique_constraints"));
  assert.match(generated.sql,/UNIQUE \("id", "poll_id"\)/);
  assert.ok(generated.risks.some(x=>x.kind==="server_authorization_required"));
  assert.match(generated.sql,/CREATE TABLE "mig_treasury_entries"/);
  assert.doesNotMatch(generated.sql,/DROP TABLE|DELETE FROM|INSERT INTO/);

  const db=new DatabaseSync(":memory:");
  try{
    db.exec(generated.sql);
    const rows=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mig_%'").all();
    assert.equal(rows.length,36);
    const columns=db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('mig_profiles')").get().n;
    assert.equal(columns,metadata.tables.find(t=>t.name==="profiles").columns.length);
    const foreignKeyCount=metadata.tables.reduce((n,t)=>n+t.foreignKeys
      .filter(f=>f.targetSchema==="public" && f.deleteRule!=="d").length,0);
    assert.equal(generated.publicForeignKeysModeled,foreignKeyCount);
    const foreignKeyStatus=db.prepare("PRAGMA foreign_key_check").all();
    assert.deepEqual(foreignKeyStatus,[]);
  }finally{db.close();}
});

test("absence d'une des 36 tables -> bloquée",()=>{
  const m=clone(metadata);
  m.tables.pop();
  assert.throws(()=>generateD1Blueprint(m),/incomplete_36_table_contract/);
});

test("une clé primaire divergente -> bloquée",()=>{
  const m=clone(metadata);
  m.tables.find(t=>t.name==="poll_votes").primaryKey=["poll_id"];
  assert.throws(()=>generateD1Blueprint(m),/primary_key_contract_mismatch/);
});

test("colonne ou type inattendu -> bloqué, sans SQL dangereux",()=>{
  for(const mutation of [
    m=>m.tables[0].columns[0].name='id"); DROP TABLE profiles; --',
    m=>m.tables[0].columns[0].pgType="unknown_type",
    m=>m.tables[0].columns.push({...m.tables[0].columns[0]}),
  ]){
    const m=clone(metadata);
    mutation(m);
    assert.throws(()=>generateD1Blueprint(m),/unsupported_or_duplicate_column/);
  }
});

test("une clé étrangère incohérente ou une contrainte inconnue est bloquée",()=>{
  const m=clone(metadata);
  const first=m.tables.find(t=>t.foreignKeys.length);
  first.foreignKeys[0].columns=["column_that_does_not_exist"];
  assert.throws(()=>generateD1Blueprint(m),/bad_foreign_key_contract/);
  const b=clone(metadata);
  b.tables[0].constraintsNotModeled.checks=-1;
  assert.throws(()=>generateD1Blueprint(b),/invalid_constraint_count/);
  const c=clone(metadata);
  const withUnique=c.tables.find(t=>t.uniqueKeys.length>0);
  withUnique.uniqueKeys=[];
  assert.throws(()=>generateD1Blueprint(c),/unique_constraints_count_mismatch/);
});

test("génération stable et strictement limitée à la structure",()=>{
  const a=generateD1Blueprint(),b=generateD1Blueprint();
  assert.equal(a.sql,b.sql);
  assert.equal(a.sql.includes("axewfeanyfxkzercafen"),false);
  assert.equal(a.sql.includes("service_role"),false);
  assert.ok(a.sql.includes("SCHEMA PILOTE LOCAL UNIQUEMENT"));
});
