import assert from 'node:assert/strict'
import { compareMigrationSnapshots, REQUIRED_TABLES } from './lib/migration-parity.mjs'
const fixture = () => ({
  schema_version:1,batch_id:'danz-test-20260924',
  tables:Object.fromEntries(REQUIRED_TABLES.map(name=>[name,{count:name==='profiles'?2:0,ids_sha256:'a'.repeat(64),canonical_rows_sha256:'b'.repeat(64)}])),
  auth:{accounts:3,profiles:2,unlinked_accounts:1,ids_sha256:'c'.repeat(64)},
  media:{files:1,bytes:1200,content_inventory_sha256:'d'.repeat(64)},
  finance:{charges_cents:2500,confirmed_payments_cents:1200,treasury_income_cents:1200,treasury_expenses_cents:300,treasury_reimbursements_cents:0}
})
const clone=x=>structuredClone(x)
const source=fixture()
assert.equal(REQUIRED_TABLES.length,29)
assert.equal(compareMigrationSnapshots(source,clone(source)).ok,true)
const assertRejected=(modify,label)=>{
 const target=clone(source);modify(target)
 const output=compareMigrationSnapshots(source,target)
 assert.equal(output.ok,false,label)
 assert.ok(output.errors.length,label)
}
assertRejected(t=>t.tables.profiles.count++,'Ligne manquante')
assertRejected(t=>t.tables.profiles.canonical_rows_sha256='e'.repeat(64),'Ligne modifiée avec comptage égal')
assertRejected(t=>{t.auth.accounts++;t.auth.unlinked_accounts++},'Identité supplémentaire')
assertRejected(t=>t.media.content_inventory_sha256='f'.repeat(64),'Fichier altéré')
assertRejected(t=>t.finance.confirmed_payments_cents+=1,'Montants divergents')
assertRejected(t=>{t.batch_id='autre-lot'},'Lot erroné')
assert.throws(()=>compareMigrationSnapshots(source,{schema_version:1}),/invalide|manquant/)
console.log('8 contrôles synthétiques de parité et anti-perte réussis (dont 7 échecs attendus).')
