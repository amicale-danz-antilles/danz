import { useState } from 'react'
import { parseReceiptList, applyReceiptBatch } from '../lib/treasuryV2Batch.js'
import { parseEuros, summarizeWorkspace } from '../lib/treasuryV2Workspace.js'
const euro=cents=>(cents/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})
export default function TreasuryV2BatchPanel({workspace,onChange}){
 const [text,setText]=useState(''),[draft,setDraft]=useState({}),[errors,setErrors]=useState([]),[date,setDate]=useState(''),[notice,setNotice]=useState('')
 const summary=summarizeWorkspace(workspace)
 const people=summary.residuals.filter(i=>i.kind==='receivable').sort((a,b)=>a.label.localeCompare(b.label,'fr'))
 const update=(id,fields)=>{setNotice('');setErrors([]);setDraft(old=>({...old,[id]:{...old[id],...fields}}))}
 const importList=()=>{
  const {rows,errors:problems}=parseReceiptList(text,workspace);setErrors(problems);setNotice('')
  setDraft({})
  if(!problems.length&&rows.length){setDraft(Object.fromEntries(rows.map(r=>[r.itemId,{checked:true,amount:(r.cents/100).toFixed(2),account:''}])));setNotice(rows.length+' ligne(s) reconnue(s). Choisir le moyen de paiement pour chacune.')}
 }
 const selected=people.filter(i=>draft[i.id]?.checked&&i.remaining>0)
 let rows=[],total=0,valid=true
 try{rows=selected.map(i=>({itemId:i.id,cents:parseEuros(draft[i.id].amount||''),account:draft[i.id].account}));total=rows.reduce((s,r)=>s+r.cents,0);valid=rows.every((r,j)=>['512','530'].includes(r.account)&&r.cents<=selected[j].remaining)}catch{valid=false}
 const day=date||summary.asOf
 const submit=e=>{
  e.preventDefault();setErrors([]);setNotice('')
  if(!valid||!rows.length)return
  try{
   const next=applyReceiptBatch(workspace,{id:crypto.randomUUID(),date:day,rows})
   onChange(next);setDraft({});setText('');setNotice(rows.length+' règlement(s) simulé(s), total '+euro(total)+'. Aucun enregistrement en production.')
  }catch(err){setErrors([err.message])}
 }
 return <section className="danz-panel danz-v2-form">
  <h3>Simuler des règlements collectifs</h3>
  <p className="danz-muted">Cocher les personnes ayant payé, saisir le montant et choisir le compte. Aucun règlement n’est enregistré en production.</p><details className="danz-import-details"><summary>Coller une liste de règlements</summary><p className="danz-muted">Une ligne par personne : Nom Prénom : montant €.</p>
  <label>Liste des règlements<textarea rows={4} value={text} onChange={e=>setText(e.target.value)} placeholder={'Personne A : 10,00 €\nPersonne B : 5 €'}/></label>
  <button type="button" className="ghost-button" disabled={!text.trim()} onClick={importList}>Analyser la liste (sans encaisser)</button></details>
  {errors.length>0&&<div role="alert" className="alert error">{errors.map((error,i)=><p key={i}>{error}</p>)}</div>}
  <form onSubmit={submit} className="danz-v2-form">
   <label>Date de règlement<input type="date" min={summary.asOf} value={day} onChange={e=>{setDate(e.target.value);setErrors([])}} required/></label>
   <div className="danz-batch-list">
    {people.map(i=>{const d=draft[i.id]||{};return <article key={i.id} className={'danz-batch-person'+(d.checked&&i.remaining?' is-selected':'')}>
      <label className="danz-batch-head"><input type="checkbox" disabled={!i.remaining} checked={!!d.checked&&i.remaining>0} onChange={e=>update(i.id,{checked:e.target.checked,amount:d.amount??(i.remaining/100).toFixed(2)})}/><span><b>{i.label}</b><small>{i.remaining?'Reste dû':'Soldé'}</small></span><strong>{euro(i.remaining)}</strong></label>
      {d.checked&&i.remaining>0&&<div className="danz-batch-fields"><label>Montant reçu (€)<input inputMode="decimal" value={d.amount||''} onChange={e=>update(i.id,{amount:e.target.value})}/></label><label>Compte<select value={d.account||''} onChange={e=>update(i.id,{account:e.target.value})}><option value="">Choisir</option><option value="512">Banque</option><option value="530">Espèces</option></select></label></div>}
    </article>})}
   </div>
   <div className="danz-batch-footer"><div><small>{selected.length} sélectionné(s)</small><strong>{euro(total)}</strong></div><button className="primary-button" disabled={!valid||!rows.length||errors.length>0}>Simuler la validation</button></div>
  </form>{notice&&<p role="status">{notice}</p>}
 </section>
}
