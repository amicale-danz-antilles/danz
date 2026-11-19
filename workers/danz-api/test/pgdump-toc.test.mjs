import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyDumpTOC } from "../migration/verify-pgdump-toc.mjs";
const contract=JSON.parse(readFileSync(new URL("../migration/source-contract.json",import.meta.url),"utf8"));
const managed=["auth.users","auth.identities","storage.objects","storage.buckets"];
function fixture(){
  let i=100;
  return [...contract.tables.map(x=>"public."+x.name),...managed]
    .flatMap(q=>{
      const [schema,table]=q.split(".");
      return [`${i++}; 1259 124 TABLE ${schema} ${table} postgres`,
        `${i++}; 0 124 TABLE DATA ${schema} ${table} postgres`];
    }).join("\n")+"\n";
}
test("un dump complet synthétique couvre tables et données publiques et gérées",()=>{
  const r=verifyDumpTOC(fixture());
  assert.equal(r.ok,true);
  assert.equal(r.tableSchemaChecked,36);
  assert.equal(r.tableDataChecked,36);
  assert.equal(r.managedSchemaChecked,4);
  assert.equal(r.managedDataChecked,4);
  assert.equal(r.restorationVerified,false);
  assert.equal(r.storageBytesVerified,false);
  assert.equal(r.encryptedCopyVerified,false);
});
test("une seule TABLE DATA absente bloque la sauvegarde",()=>{
  const r=verifyDumpTOC(fixture().replace(/\d+; 0 124 TABLE DATA public treasury_entries postgres\n/,""));
  assert.equal(r.ok,false);
  assert.equal(r.missingCount,1);
  assert.equal(r.tableDataChecked,35);
});
test("absence de comptes et Storage bloque la validation",()=>{
  const s=fixture().split("\n").filter(x=>!x.includes("TABLE DATA auth.users")&&!x.includes("TABLE DATA storage.objects")).join("\n");
  const r=verifyDumpTOC(s);
  assert.equal(r.ok,false);
  assert.equal(r.managedDataChecked,2);
  assert.equal(r.missingCount,2);
});
test("les commentaires et pseudo catalogues ne sont pas acceptés",()=>{
  const s=fixture().replace(/^\d+; 0 124 TABLE DATA public profiles postgres/m,"-- 123; 0 124 TABLE DATA public profiles postgres");
  assert.equal(verifyDumpTOC(s).ok,false);
  assert.equal(verifyDumpTOC("").ok,false);
});
