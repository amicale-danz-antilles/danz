import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspace,summarizeWorkspace } from '../src/lib/treasuryV2Workspace.js'
import { parseReceiptList,applyReceiptBatch,applySettlementBatch } from '../src/lib/treasuryV2Batch.js'
const workspace=()=>createWorkspace({version:1,asOf:'2026-01-01',bankCents:10000,cashCents:5000,receivables:[{id:'a',label:'Exemple André',cents:1000},{id:'b',label:'Exemple Béatrice',cents:2000}],payables:[]})
test('collage : accents, ordre du nom, virgule et puce',()=>{
 const r=parseReceiptList('• André Exemple : 5,50 €\nExemple Beatrice : 20 EUR',workspace())
 assert.equal(r.errors.length,0);assert.deepEqual(r.rows.map(x=>x.cents),[550,2000])
})
test('liste : doublon, inconnu, montant excessif et format incorrect',()=>{
 const r=parseReceiptList('Exemple André : 5 €\nAndré Exemple : 1 €\nInconnu : 10 €\nExemple Béatrice : 21 €\nMauvais format',workspace())
 assert.equal(r.errors.length,4);assert.equal(r.rows.length,1)
})
test('lot : ventilation, partiel, intégral, situation nette inchangée',()=>{
 const w=workspace(),next=applyReceiptBatch(w,{id:'lot',date:'2026-01-02',rows:[{itemId:'a',cents:500,account:'512'},{itemId:'b',cents:2000,account:'530'}]})
 const s=summarizeWorkspace(next);assert.equal(s.bank,10500);assert.equal(s.cash,7000);assert.equal(s.receivables,500);assert.equal(s.net,18000);assert.equal(summarizeWorkspace(w).receivables,3000)
 assert.throws(()=>applyReceiptBatch(next,{id:'new',date:'2026-01-02',rows:[{itemId:'b',cents:1,account:'530'}]}))
 assert.equal(parseReceiptList('Exemple Béatrice : 1 €',next).errors.length,1)
})
test('lot invalide : aucune modification du journal original',()=>{
 const w=workspace();assert.throws(()=>applyReceiptBatch(w,{id:'lot',date:'2026-01-02',rows:[{itemId:'a',cents:500,account:'512'},{itemId:'b',cents:2001,account:'530'}]}));assert.equal(summarizeWorkspace(w).receivables,3000)
 assert.throws(()=>applyReceiptBatch(w,{id:'dup',date:'2026-01-02',rows:[{itemId:'a',cents:1,account:'512'},{itemId:'a',cents:1,account:'530'}]}))
})

test('trop-perçu confirmé : dette soldée, avoir remboursable, résultat net inchangé',()=>{
 const w=workspace(),next=applySettlementBatch(w,{id:'extra',date:'2026-01-02',rows:[{itemId:'a',cents:1700,account:'512',allowOverpayment:true}]})
 const s=summarizeWorkspace(next),credit=s.residuals.find(i=>i.subtype==='overpayment')
 assert.equal(s.bank,11700);assert.equal(s.receivables,2000);assert.equal(s.payables,700);assert.equal(s.net,18000);assert.equal(credit.remaining,700)
 assert.equal(next.entries.at(-1).lines.length,3)
 const refunded=applySettlementBatch(next,{id:'refund',date:'2026-01-03',rows:[{itemId:credit.id,cents:300,account:'512'}]})
 assert.equal(summarizeWorkspace(refunded).payables,400);assert.equal(summarizeWorkspace(refunded).bank,11400);assert.equal(summarizeWorkspace(refunded).net,18000)
 assert.throws(()=>applySettlementBatch(refunded,{id:'too-much',date:'2026-01-03',rows:[{itemId:credit.id,cents:401,account:'512',allowOverpayment:true}]}))
})
test('lot mixte: encaissement et remboursement dans une même validation',()=>{
 const w=createWorkspace({version:1,asOf:'2026-01-01',bankCents:10000,cashCents:5000,receivables:[{id:'a',label:'Test A',cents:1000}],payables:[{id:'p',label:'Test P',cents:2000}]})
 const next=applySettlementBatch(w,{id:'mix',date:'2026-01-02',rows:[{itemId:'a',cents:500,account:'530'},{itemId:'p',cents:1000,account:'512'}]})
 const s=summarizeWorkspace(next);assert.equal(s.bank,9000);assert.equal(s.cash,5500);assert.equal(s.receivables,500);assert.equal(s.payables,1000);assert.equal(s.net,14000)
})
test('import de surplus autorisé mais confirmation exigée pour le règlement',()=>{
 const w=workspace(),r=parseReceiptList('Exemple André : 17 €',w,{allowOverpayment:true});assert.equal(r.errors.length,0);assert.equal(r.rows[0].cents,1700)
 assert.throws(()=>applySettlementBatch(w,{id:'no-confirm',date:'2026-01-02',rows:[{itemId:'a',cents:1700,account:'512'}]}))
 assert.equal(summarizeWorkspace(w).receivables,3000)
})
