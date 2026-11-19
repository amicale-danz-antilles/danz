import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareSnapshots } from "../migration/compare-snapshots.mjs";

const contract = JSON.parse(readFileSync(new URL("../migration/source-contract.json",import.meta.url),"utf8"));
const DEMO_HASH="a".repeat(64);

function sample() {
  return {
    format:"DANZ-PRIVATE-1",
    tables:Object.fromEntries(contract.tables.map(item=>[item.name,[]])),
    assets:[{key:"test://photo",bytes:12,sha256:DEMO_HASH}],
    authAccounts:[{
      id:"test-user",role:"member",active:true,
      is_treasurer:false,household_id:"test-household",
    }],
  };
}
const clone = o=>structuredClone(o);

test("inventaire exhaustif : 36 tables, neuf fonctions, cles primaires identifiees",()=>{
  assert.equal(contract.tables.length,36);
  assert.equal(contract.edgeFunctions.length,9);
  assert.equal(contract.tables.filter(x=>x.primaryKey.length>1).length,5);
  assert.ok(contract.tables.every(x=>x.primaryKey.length>=1));
});

test("une copie integrale des donnees fictives valide le controle",()=>{
  const a=sample();
  a.tables.profiles.push({id:"test-user",full_name:"Fictif seulement",role:"member",active:true});
  a.tables.household_payment_allocations.push({
    payment_id:"fake-pay",charge_id:"fake-charge",amount_cents:100,
  });
  const b=clone(a);
  b.tables.profiles[0]={active:true,role:"member",id:"test-user",full_name:"Fictif seulement"};
  const result=compareSnapshots(a,b);
  assert.equal(result.ok,true);
  assert.equal(result.areasChecked,38);
  assert.deepEqual(result.issues,[]);
});

test("perte d'une ligne detectee sans reveler les informations",()=>{
  const a=sample(),b=clone(a);
  a.tables.profiles=[{id:"test-person",email:"secret@example.invalid",active:true}];
  const report=compareSnapshots(a,b);
  assert.equal(report.ok,false);
  assert.ok(report.issues.some(x=>x.area==="table:profiles"&&x.missing===1));
  assert.doesNotMatch(JSON.stringify(report),/secret|test-person|@/);
});

test("aucune modification silencieuse d'un montant en centimes",()=>{
  const a=sample(),b=clone(a);
  a.tables.treasury_entries=[{id:"demo-1",amount_cents:1500,status:"settled"}];
  b.tables.treasury_entries=[{id:"demo-1",amount_cents:1499,status:"settled"}];
  const report=compareSnapshots(a,b);
  assert.ok(report.issues.some(x=>x.area==="table:treasury_entries"&&x.changed===1));
});

test("cles composees manquantes detectees",()=>{
  const a=sample(),b=clone(a);
  a.tables.poll_votes=[{poll_id:"poll-1",user_id:"member-1",value:1}];
  const report=compareSnapshots(a,b);
  assert.ok(report.issues.some(x=>x.area==="table:poll_votes"&&x.missing===1));
});

test("doublons et tables manquantes bloquent la validation",()=>{
  const a=sample(),b=clone(a);
  b.tables.profiles=[{id:"duplicate"},{id:"duplicate"}];
  delete b.tables.membership_subscriptions;
  assert.equal(compareSnapshots(a,b).ok,false);
});

test("perte d'un justificatif ou modification du SHA256 bloquee",()=>{
  const a=sample(),b=clone(a);
  b.assets[0].sha256="b".repeat(64);
  const report=compareSnapshots(a,b);
  assert.equal(report.ok,false);
  assert.ok(report.issues.some(x=>x.area==="files"&&x.changed===1));
  delete b.assets;
  assert.equal(compareSnapshots(a,b).ok,false);
});

test("perte de droit de tresorerie ou de compte bloque la migration",()=>{
  const a=sample(),b=clone(a);
  b.authAccounts[0].role="admin";
  b.authAccounts[0].is_treasurer=true;
  assert.ok(compareSnapshots(a,b).issues.some(x=>x.area==="authAccounts"&&x.changed===1));
  b.authAccounts=[];
  assert.equal(compareSnapshots(a,b).ok,false);
});

test("chiffres non fiables et formats invalides refusent la migration",()=>{
  const a=sample(),b=clone(a);
  b.format="not-a-snapshot";
  assert.equal(compareSnapshots(a,b).ok,false);
  b.format=a.format;
  a.tables.treasury_entries=[{id:"fake",amount_cents:Number.MAX_SAFE_INTEGER+1}];
  assert.equal(compareSnapshots(a,b).ok,false);
});
