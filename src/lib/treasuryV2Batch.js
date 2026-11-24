import { parseEuros, simulateSettlement, summarizeWorkspace } from './treasuryV2Workspace.js'
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]+/gu,' ').trim()
const nameKey = value => normalize(value).split(' ').sort().join(' ')
const clean = line => line.trim().replace(/^[-•*]\s*/, '')
export function parseReceiptList(text, workspace) {
 if(typeof text!=='string'||text.length>30000) throw new Error('Liste invalide ou trop volumineuse')
 const items=summarizeWorkspace(workspace).residuals.filter(i=>i.kind==='receivable')
 const rows=[], errors=[], seen=new Set()
 for(const [index,raw] of text.split(/\r?\n/).entries()){
  const line=clean(raw)
  if(!line) continue
  const match=line.match(/^(.+?)\s*[:;]\s*(\d+(?:[,.]\d{1,2})?)\s*(?:€|EUR)?\s*$/i)
  if(!match){errors.push('Ligne '+(index+1)+' : format attendu Nom Prénom : montant €');continue}
  const matches=items.filter(i=>nameKey(i.label)===nameKey(match[1]))
  if(matches.length!==1){errors.push('Ligne '+(index+1)+' : personne inconnue ou ambiguë');continue}
  const item=matches[0]
  let cents
  try{cents=parseEuros(match[2])}catch{errors.push('Ligne '+(index+1)+' : montant invalide');continue}
  if(seen.has(item.id)){errors.push('Ligne '+(index+1)+' : doublon');continue}
  if(cents>item.remaining){errors.push('Ligne '+(index+1)+' : montant supérieur au reste dû');continue}
  seen.add(item.id);rows.push({itemId:item.id,label:item.label,cents})
 }
 return {rows,errors}
}
export function applyReceiptBatch(workspace, batch) {
 if(!batch||typeof batch.id!=='string'||!batch.id.trim()||batch.id.length>100||!Array.isArray(batch.rows)||batch.rows.length<1||batch.rows.length>100)throw new Error('Lot invalide')
 const initial=summarizeWorkspace(workspace),seen=new Set()
 let next=workspace
 for(const [index,row] of batch.rows.entries()){
  if(!row||seen.has(row.itemId))throw new Error('Personne présente plusieurs fois')
  if(!initial.residuals.some(i=>i.id===row.itemId&&i.kind==='receivable'))throw new Error('Créance inconnue')
  seen.add(row.itemId)
  next=simulateSettlement(next,{id:batch.id+':'+index,itemId:row.itemId,cents:row.cents,account:row.account,date:batch.date})
 }
 return next
}
