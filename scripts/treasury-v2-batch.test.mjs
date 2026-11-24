import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspace,summarizeWorkspace } from '../src/lib/treasuryV2Workspace.js'
import { parseReceiptList,applyReceiptBatch } from '../src/lib/treasuryV2Batch.js'
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
