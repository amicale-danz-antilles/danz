import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspace, summarizeWorkspace, simulateSettlement, parseEuros } from '../src/lib/treasuryV2Workspace.js'
import { accountBalances } from '../src/lib/treasuryV2Prototype.js'
const reference=()=>({version:1,asOf:'2026-01-01',bankCents:30000,cashCents:10000,receivables:[{id:'r1',label:'Test A',cents:12000},{id:'r2',label:'Test B',cents:2000}],payables:[{id:'p1',label:'Test C',cents:7000}]})
const op=(id,itemId,cents,account='512',date='2026-01-02')=>({id,itemId,cents,account,date})
test('reprise: aucune recette ni charge nouvelle',()=>{
 const w=createWorkspace(reference()),s=summarizeWorkspace(w),b=accountBalances(w.entries,s.asOf)
 assert.equal(s.available,40000);assert.equal(s.receivables,14000);assert.equal(s.payables,7000);assert.equal(s.net,47000);assert.equal(s.afterReserve,33000)
 assert.equal(b['110'],-47000);assert.equal(b['756'],undefined);assert.equal(b['606'],undefined)
})
test('règlement partiel: trésorerie et créances évoluent sans modifier la situation nette',()=>{
 const w=createWorkspace(reference()),n=simulateSettlement(w,op('1','r1',5000)),s=summarizeWorkspace(n)
 assert.equal(s.bank,35000);assert.equal(s.receivables,9000);assert.equal(s.net,47000);assert.equal(s.residuals[0].remaining,7000)
 assert.equal(summarizeWorkspace(w).bank,30000)
})
test('remboursement partiel: pas de deuxième charge',()=>{
 const w=simulateSettlement(createWorkspace(reference()),op('1','p1',3000,'530')),s=summarizeWorkspace(w)
 assert.equal(s.cash,7000);assert.equal(s.payables,4000);assert.equal(s.net,47000)
 assert.equal(accountBalances(w.entries,s.asOf)['606'],undefined)
})
test('blocage de double règlement, montant excessif et date passée',()=>{
 const w=simulateSettlement(createWorkspace(reference()),op('1','r2',2000))
 assert.throws(()=>simulateSettlement(w,op('2','r2',1)))
 assert.throws(()=>simulateSettlement(w,op('1','r1',100)))
 assert.throws(()=>simulateSettlement(w,op('2','r1',12001)))
 assert.throws(()=>simulateSettlement(w,op('2','r1',100,'512','2025-12-31')))
})
test('refuse les remboursements sur une poche insuffisante',()=>{
 const ref=reference();ref.cashCents=100
 assert.throws(()=>simulateSettlement(createWorkspace(ref),op('1','p1',101,'530')))
})
test('entrée invalide et euros: aucun arrondi implicite',()=>{
 const ref=reference();ref.receivables.push({...ref.receivables[0]})
 assert.throws(()=>createWorkspace(ref))
 assert.throws(()=>createWorkspace({...reference(),bankCents:1.5}))
 assert.throws(()=>createWorkspace({...reference(),asOf:'2026-02-30'}))
 assert.equal(parseEuros('12,50'),1250);assert.equal(parseEuros('0.01'),1)
 for(const amount of ['0','-1','1.001','1e2','NaN',''])assert.throws(()=>parseEuros(amount))
})
