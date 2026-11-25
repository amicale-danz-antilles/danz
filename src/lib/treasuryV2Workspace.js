import { validateJournal, position } from './treasuryV2Prototype.js'

const integer = (n, positive=false) => Number.isSafeInteger(n) && n >= (positive ? 1 : 0)
const labelOk = s => typeof s==='string' && s.trim().length>0 && s.length<=200
const dateOk = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s
const line=(account,side,cents)=>({account,side,cents})
const pair=(id,date,label,debit,credit,cents,extra={})=>({id,source:id,date,label,lines:[line(debit,'D',cents),line(credit,'C',cents)],...extra})
export function createWorkspace(reference) {
  if(!reference || reference.version!==1 || !dateOk(reference.asOf) || !integer(reference.bankCents) || !integer(reference.cashCents) || !Array.isArray(reference.receivables) || !Array.isArray(reference.payables)) throw new Error('Fichier de reprise invalide')
  const items=[], ids=new Set()
  for(const [kind,rows] of [['receivable',reference.receivables],['payable',reference.payables]]) for(const row of rows){
    if(!row || !labelOk(row.id) || !labelOk(row.label) || !integer(row.cents,true) || ids.has(row.id)) throw new Error('Créance ou dette invalide / doublon')
    ids.add(row.id); items.push({id:row.id,label:row.label,cents:row.cents,kind})
  }
  const date=reference.asOf, entries=[]
  if(reference.bankCents) entries.push(pair('opening:bank',date,'Reprise banque','512','110',reference.bankCents))
  if(reference.cashCents) entries.push(pair('opening:cash',date,'Reprise caisse','530','110',reference.cashCents))
  for(const item of items) {
    const recv=item.kind==='receivable'
    entries.push(pair('opening:item:'+item.id,date,'Reprise '+item.label,recv?'4672':'110',recv?'110':'4673',item.cents,{itemId:item.id}))
  }
  validateJournal(entries)
  const workspace={asOf:date,items,entries,operations:[]}
  summarizeWorkspace(workspace)
  return workspace
}
export function summarizeWorkspace(workspace) {
  const date=workspace.operations.at(-1)?.date || workspace.asOf
  const balances=position(workspace.entries,date)
  const residuals=workspace.items.map(item=>{
    const paid=workspace.operations.filter(o=>o.itemId===item.id).reduce((s,o)=>s+o.cents,0)
    if(!integer(paid) || paid>item.cents) throw new Error('Règlement incohérent')
    return {...item,remaining:item.cents-paid}
  })
  const receivables=residuals.filter(i=>i.kind==='receivable').reduce((s,i)=>s+i.remaining,0)
  const payables=residuals.filter(i=>i.kind==='payable').reduce((s,i)=>s+i.remaining,0)
  if(!integer(receivables)||!integer(payables)||receivables!==balances.receivables||payables!==balances.advances) throw new Error('Écart entre journal et comptes individuels')
  const afterReserve=balances.available-payables, net=afterReserve+receivables
  if(!Number.isSafeInteger(net)||!Number.isSafeInteger(afterReserve)) throw new Error('Solde hors limites')
  return {...balances,receivables,payables,afterReserve,net,residuals,asOf:date}
}
export function simulateSettlement(workspace, operation) {
  if(!operation || !labelOk(operation.id) || !dateOk(operation.date) || !integer(operation.cents,true) || !['512','530'].includes(operation.account)) throw new Error('Règlement invalide')
  const current=summarizeWorkspace(workspace)
  if(operation.date<current.asOf) throw new Error('Date antérieure à la dernière opération')
  const item=current.residuals.find(i=>i.id===operation.itemId)
  if(!item || item.remaining===0) throw new Error('Créance ou dette déjà soldée ou inconnue')
  const recv=item.kind==='receivable'
  const surplus=Math.max(0,operation.cents-item.remaining)
  if(surplus&&(!recv||operation.allowOverpayment!==true)) throw new Error('Montant supérieur au reste dû : confirmation du trop-perçu nécessaire')
  if(!recv && operation.cents>(operation.account==='512'?current.bank:current.cash)) throw new Error('Fonds insuffisants sur le compte choisi')
  const applied=operation.cents-surplus
  const entry=pair('settlement:'+operation.id,operation.date,(recv?'Encaissement ':'Remboursement ')+item.label,recv?operation.account:'4673',recv?'4672':operation.account,applied,{itemId:item.id})
  const creditId='credit:'+operation.id
  if(surplus&&workspace.items.some(i=>i.id===creditId))throw new Error('Identifiant de trop-perçu déjà utilisé')
  const credit=surplus?{id:creditId,label:item.label,cents:surplus,kind:'payable',subtype:'overpayment',originItemId:item.id}:null
  if(credit){entry.lines=[line(operation.account,'D',operation.cents),line('4672','C',applied),line('4673','C',surplus)]}
  const next={...workspace,items:credit?[...workspace.items,credit]:workspace.items,entries:[...workspace.entries,entry],operations:[...workspace.operations,{id:operation.id,date:operation.date,itemId:item.id,account:operation.account,cents:applied,receivedCents:operation.cents,surplusCents:surplus}]}
  summarizeWorkspace(next)
  return next
}
export function parseEuros(value) {
  if(typeof value!=='string'||!/^\d+(?:[,.]\d{1,2})?$/.test(value.trim())) throw new Error('Montant en euros invalide')
  const [euros,decimal='']=value.trim().replace(',','.').split('.')
  const cents=Number(euros)*100+Number(decimal.padEnd(2,'0'))
  if(!integer(cents,true)) throw new Error('Montant invalide')
  return cents
}
