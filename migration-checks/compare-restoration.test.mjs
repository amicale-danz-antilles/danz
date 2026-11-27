import test from 'node:test'
import assert from 'node:assert/strict'
import { requiredTables, compareSnapshots, parseSnapshot } from './compare-restoration.mjs'
const records=requiredTables.map(table=>({table,rows:'2',sha256:'a'.repeat(64)}))
const ndjson=rows=>rows.map(x=>JSON.stringify(x)).join('\n')
test('full current contract, order independent',()=>{
 assert.equal(requiredTables.length,79)
 assert.equal(compareSnapshots(ndjson(records),ndjson([...records].reverse())).ok,true)
})
test('both snapshots omitting a private staging table fail',()=>{
 const rows=records.filter(x=>x.table!=='danz_finance_v2_staging.reprise')
 assert.equal(compareSnapshots(ndjson(rows),ndjson(rows)).ok,false)
})
test('omitted auth, storage or business table fails',()=>{
 for(const table of ['auth.identities','storage.objects','public.household_payment_allocations']){
  assert.equal(compareSnapshots(ndjson(records),ndjson(records.filter(x=>x.table!==table))).ok,false)
 }
})
test('changed row digest even with unchanged row count fails',()=>{
 const rows=records.map(x=>x.table==='public.treasury_entries'?{...x,sha256:'b'.repeat(64)}:x)
 assert.equal(compareSnapshots(ndjson(records),ndjson(rows)).ok,false)
})
test('row count, unexpected tables, malformed and duplicate input fail',()=>{
 assert.equal(compareSnapshots(ndjson(records),ndjson(records.map((x,i)=>i?x:{...x,rows:'3'}))).ok,false)
 assert.equal(compareSnapshots(ndjson(records),ndjson([...records,{table:'public.extra',rows:'0',sha256:'a'.repeat(64)}])).ok,false)
 assert.throws(()=>parseSnapshot(ndjson([...records,records[0]])))
 assert.throws(()=>parseSnapshot('malformed'))
 assert.throws(()=>parseSnapshot(ndjson([{...records[0],rows:'-1'}])))
})
