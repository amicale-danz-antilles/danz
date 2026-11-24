import test from 'node:test';
import assert from 'node:assert/strict';
import {validateJournal,position,accountBalances} from '../src/lib/treasuryV2Prototype.js';
const entry=(id,date,lines,more={})=>({id,source:'synthetic:'+id,date,lines:lines.map(([account,side,cents])=>({account,side,cents})),...more});
const payment=entry('p','2026-01-01',[['4671','D',6000],['756','C',6000]]);
const payout=entry('v','2026-01-02',[['512','D',6000],['4671','C',6000]]);
test('collecte puis versement: une seule recette',()=>{
 assert.equal(position([payment], '2026-01-01').available,0);
 assert.equal(position([payment], '2026-01-01').processor,6000);
 assert.equal(position([payment,payout], '2026-01-02').available,6000);
 assert.equal(position([payment,payout], '2026-01-02').processor,0);
 assert.equal(accountBalances([payment,payout], '2026-01-02')['756'],-6000);
});
test('transfert interne sans recette nouvelle',()=>{
 const t=entry('t','2026-01-03',[['530','D',2000],['512','C',2000]]);
 assert.equal(position([payment,payout,t],'2026-01-03').available,6000);
});
test('avance puis remboursement partiel',()=>{
 const a=entry('a','2026-01-03',[['606','D',8000],['4673','C',8000]]);
 const r=entry('r','2026-01-04',[['4673','D',3000],['512','C',3000]]);
 assert.equal(position([payment,payout,a],'2026-01-03').advances,8000);
 assert.equal(position([payment,payout,a,r],'2026-01-04').advances,5000);
 assert.equal(accountBalances([payment,payout,a,r],'2026-01-04')['606'],8000);
});
test('contrepassation conserve le solde historique',()=>{
 const r=entry('r','2026-01-03',[['756','D',6000],['4671','C',6000]],{reverses:'p'});
 assert.equal(position([payment,r],'2026-01-01').processor,6000);
 assert.equal(position([payment,r],'2026-01-03').processor,0);
 assert.throws(()=>validateJournal([payment,r,entry('r2','2026-01-04',[['756','D',6000],['4671','C',6000]],{reverses:'p'})]));
});
test('refus des doublons, montants fractionnaires, comptes inconnus, dates impossibles et desequilibres',()=>{
 assert.throws(()=>validateJournal([payment,payment]));
 assert.throws(()=>validateJournal([payment,{...payout,source:payment.source}]));
 for(const x of [
 entry('x','2026-01-01',[['512','D',100],['756','C',99]]),
 entry('x','2026-01-01',[['512','D',1.5],['756','C',1.5]]),
 entry('x','2026-01-01',[['999','D',100],['756','C',100]]),
 entry('x','2026-02-30',[['512','D',100],['756','C',100]])
 ]) assert.throws(()=>validateJournal([x]));
});
test('fonds non localises exclus des disponibilites',()=>{
 const o=entry('o','2026-01-01',[['471','D',10000],['110','C',10000]]);
 assert.equal(position([o],'2026-01-01').available,0);
 assert.equal(position([o],'2026-01-01').unassigned,10000);
});
