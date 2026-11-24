import { useState } from 'react'
import { parseReceiptList, applySettlementBatch } from '../lib/treasuryV2Batch.js'
import { parseEuros, summarizeWorkspace } from '../lib/treasuryV2Workspace.js'
const euro=cents=>(cents/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})
const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const amountOrZero=s=>{try{return parseEuros(s||'')}catch{return 0}}
export default function TreasuryV2BatchPanel({workspace,onChange}){
 const [text,setText]=useState(''),[draft,setDraft]=useState({}),[errors,setErrors]=useState([]),[date,setDate]=useState(''),[notice,setNotice]=useState(''),[filter,setFilter]=useState(''),[showSettled,setShowSettled]=useState(false)
 const summary=summarizeWorkspace(workspace)
 const people=summary.residuals.slice().sort((a,b)=>a.label.localeCompare(b.label,'fr')||a.kind.localeCompare(b.kind))
 const visible=people.filter(i=>(showSettled||i.remaining>0)&&normalize(i.label).includes(normalize(filter)))
 const update=(id,fields)=>{setNotice('');setErrors([]);setDraft(old=>({...old,[id]:{...old[id],...fields}}))}
 const importList=()=>{
  try{
   const {rows,errors:problems}=parseReceiptList(text,workspace,{allowOverpayment:true});setErrors(problems);setNotice('');setDraft({})
   if(!problems.length&&rows.length){setDraft(Object.fromEntries(rows.map(r=>[r.itemId,{checked:true,amount:(r.cents/100).toFixed(2),account:'',allowOverpayment:false}])));setFilter('');setNotice(rows.length+' ligne(s) reconnue(s). Vérifier les montants et choisir les comptes.')}
  }catch(e){setDraft({});setErrors([e.message])}
 }
 const selected=people.filter(i=>draft[i.id]?.checked&&i.remaining>0)
 const rows=selected.map(i=>({itemId:i.id,cents:amountOrZero(draft[i.id].amount),account:draft[i.id].account,allowOverpayment:draft[i.id].allowOverpayment===true}))
 const valid=rows.every((r,j)=>r.cents>0&&['512','530'].includes(r.account)&&(r.cents<=selected[j].remaining||(selected[j].kind==='receivable'&&r.allowOverpayment)))
 const incoming=rows.reduce((n,r,j)=>n+(selected[j].kind==='receivable'?r.cents:0),0)
 const outgoing=rows.reduce((n,r,j)=>n+(selected[j].kind==='payable'?r.cents:0),0)
 const day=date>=summary.asOf?date:summary.asOf
 const submit=e=>{
  e.preventDefault();setNotice('')
  if(!valid||!rows.length||errors.length)return
  try{
   const next=applySettlementBatch(workspace,{id:crypto.randomUUID(),date:day,rows})
   onChange(next);setDraft({});setText('');setNotice(rows.length+' règlement(s) simulé(s). Aucun enregistrement en production.')
  }catch(err){setErrors([err.message])}
 }
 return <section className="danz-panel danz-v2-form danz-unified">
  <div className="danz-panel-heading"><div><h3>Dettes et remboursements</h3><small>Une seule liste · {people.filter(i=>i.remaining>0).length} opération(s) en attente</small></div></div>
  <div className="danz-unified-totals"><div><small>À recevoir</small><strong className="danz-in">{euro(summary.receivables)}</strong></div><div><small>À verser</small><strong className="danz-out">{euro(summary.payables)}</strong></div></div>
  <p className="danz-muted">Sélectionner les personnes, ajuster les montants et simuler la validation. Un surplus reçu devient un avoir à rembourser, pas une recette supplémentaire.</p>
  <label>Rechercher<input type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Nom ou prénom"/></label>
  <details className="danz-import-details"><summary>Coller une liste d'encaissements</summary><label>Nom Prénom : montant €<textarea rows={3} value={text} onChange={e=>setText(e.target.value)} placeholder={'Personne A : 10,00 €\nPersonne B : 5 €'}/></label><button type="button" className="ghost-button" disabled={!text.trim()} onClick={importList}>Analyser la liste</button></details>
  {errors.length>0&&<div role="alert" className="alert error">{errors.map((error,i)=><p key={i}>{error}</p>)}</div>}
  <form onSubmit={submit} className="danz-v2-form">
   <div className="danz-batch-list">
    {visible.map(i=>{const d=draft[i.id]||{},recv=i.kind==='receivable',surplus=recv?Math.max(0,amountOrZero(d.amount)-i.remaining):0;return <article key={i.id} className={'danz-batch-person danz-unified-person '+(recv?'is-in':'is-out')+(d.checked&&i.remaining?' is-selected':'')}>
      <label className="danz-batch-head"><input type="checkbox" disabled={!i.remaining} checked={!!d.checked&&i.remaining>0} onChange={e=>update(i.id,{checked:e.target.checked,amount:(i.remaining/100).toFixed(2),allowOverpayment:false})}/><span><b>{i.label}</b><small>{!i.remaining?'Soldé':i.subtype==='overpayment'?'Avoir · surplus reçu':recv?'↓ À encaisser':'↑ À rembourser'}</small></span><strong className={recv?'danz-in':'danz-out'}>{recv?'+':'−'}{euro(i.remaining)}</strong></label>
      {d.checked&&i.remaining>0&&<div className="danz-batch-fields"><label>{recv?'Montant reçu (€)':'Montant versé (€)'}<input inputMode="decimal" value={d.amount||''} onChange={e=>update(i.id,{amount:e.target.value,allowOverpayment:false})}/></label><label>Compte<select value={d.account||''} onChange={e=>update(i.id,{account:e.target.value})}><option value="">Choisir</option><option value="512">Banque</option><option value="530">Espèces</option></select></label>
      <button type="button" className="ghost-button danz-exact" onClick={()=>update(i.id,{amount:(i.remaining/100).toFixed(2),allowOverpayment:false})}>Montant exact</button>
      {surplus>0&&<label className="danz-overpayment"><span>Dette soldée : {euro(i.remaining)} · Avoir à rembourser : {euro(surplus)}</span><span><input type="checkbox" checked={!!d.allowOverpayment} onChange={e=>update(i.id,{allowOverpayment:e.target.checked})}/> Confirmer ce trop-perçu</span></label>}
      {!recv&&amountOrZero(d.amount)>i.remaining&&<p className="danz-overpayment" role="alert">Le remboursement ne peut pas dépasser la dette.</p>}
      </div>}
    </article>})}
   </div>
   {!visible.length&&<p className="danz-muted">Aucune opération correspondante.</p>}
   <label className="danz-settled-toggle"><input type="checkbox" checked={showSettled} onChange={e=>setShowSettled(e.target.checked)}/> Afficher aussi les opérations soldées</label>
   {selected.length>0&&<><label>Date de règlement<input type="date" min={summary.asOf} value={day} onChange={e=>{setDate(e.target.value);setErrors([])}} required/></label><div className="danz-batch-footer"><div><small>{selected.length} sélectionné(s)</small><strong className="danz-in">+{euro(incoming)}</strong><strong className="danz-out">−{euro(outgoing)}</strong></div><button className="primary-button" disabled={!valid||errors.length>0}>Simuler la validation</button></div></>}
  </form>{notice&&<p role="status">{notice}</p>}
 </section>
}
