import { useState } from 'react'
import { parseReceiptList, applySettlementBatch } from '../lib/treasuryV2Batch.js'
import { parseEuros, summarizeWorkspace } from '../lib/treasuryV2Workspace.js'
const euro=cents=>(cents/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})
const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const amountOrZero=s=>{try{return parseEuros(s||'')}catch{return 0}}
const today=()=>{const parts=new Intl.DateTimeFormat('fr-FR',{timeZone:'America/Martinique',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=t=>parts.find(p=>p.type===t)?.value;return get('year')+'-'+get('month')+'-'+get('day')}
export default function TreasuryV2BatchPanel({workspace,onChange}){
 const [text,setText]=useState(''),[draft,setDraft]=useState({}),[errors,setErrors]=useState([]),[date,setDate]=useState(today),[notice,setNotice]=useState(''),[filter,setFilter]=useState(''),[showSettled,setShowSettled]=useState(false)
 const summary=summarizeWorkspace(workspace)
 const people=summary.residuals.slice().sort((a,b)=>a.label.localeCompare(b.label,'fr')||a.kind.localeCompare(b.kind))
 const visible=people.filter(i=>(showSettled||i.remaining>0)&&normalize(i.label).includes(normalize(filter)))
 const update=(id,fields)=>{setNotice('');setErrors([]);setDraft(old=>({...old,[id]:{...old[id],...fields}}))}
 const importList=()=>{
  try{
   const {rows,errors:problems}=parseReceiptList(text,workspace,{allowOverpayment:true});setErrors(problems);setNotice('');setDraft({})
   if(!problems.length&&rows.length){setDraft(Object.fromEntries(rows.map(r=>[r.itemId,{checked:true,amount:(r.cents/100).toFixed(2),account:'',allowOverpayment:false}])));setFilter('');setNotice(rows.length+' ligne(s) reconnue(s). Choisir le moyen de paiement de chaque personne.')}
  }catch(e){setDraft({});setErrors([e.message])}
 }
 const selected=people.filter(i=>draft[i.id]?.checked&&i.remaining>0)
 const rowFor=i=>({itemId:i.id,cents:amountOrZero(draft[i.id]?.amount),account:draft[i.id]?.account,allowOverpayment:draft[i.id]?.allowOverpayment===true})
 const validRow=(r,i)=>r.cents>0&&['512','530'].includes(r.account)&&(r.cents<=i.remaining||(i.kind==='receivable'&&r.allowOverpayment))
 const rows=selected.map(rowFor)
 const valid=rows.every((r,j)=>validRow(r,selected[j]))
 const incoming=rows.reduce((n,r,j)=>n+(selected[j].kind==='receivable'?r.cents:0),0)
 const outgoing=rows.reduce((n,r,j)=>n+(selected[j].kind==='payable'?r.cents:0),0)
 const day=date>=summary.asOf?date:summary.asOf
 const dateValid=!!date&&day<=today()
 const submitRows=(list)=>{
  setNotice('');setErrors([])
  if(!list.length||!dateValid||!list.every(r=>{const i=people.find(x=>x.id===r.itemId);return i&&i.remaining>0&&validRow(r,i)}))return
  try{
   const next=applySettlementBatch(workspace,{id:crypto.randomUUID(),date:day,rows:list})
   onChange(next);setDraft(old=>Object.fromEntries(Object.entries(old).filter(([id])=>!list.some(r=>r.itemId===id))));setText('');setNotice(list.length+' règlement(s) simulé(s). Aucun enregistrement en production.')
  }catch(err){setErrors([err.message])}
 }
 return <section className="danz-panel danz-v2-form danz-unified danz-quick-settlement">
  <div className="danz-panel-heading"><div><h3>Dettes et remboursements</h3><small>{people.filter(i=>i.remaining>0).length} opération(s) en attente</small></div></div>
  <div className="danz-unified-totals"><div><small>À recevoir</small><strong className="danz-in">{euro(summary.receivables)}</strong></div><div><small>À verser</small><strong className="danz-out">{euro(summary.payables)}</strong></div></div>
  <p className="danz-muted">Appuyer sur une personne, modifier le montant et choisir espèces ou virement. Mode simulation.</p>
  <label>Rechercher<input type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Nom ou prénom"/></label>
  <details className="danz-import-details"><summary>Importer plusieurs règlements</summary><label>Nom Prénom : montant €<textarea rows={3} value={text} onChange={e=>setText(e.target.value)} placeholder={'Personne A : 10,00 €\nPersonne B : 5 €'}/></label><button type="button" className="ghost-button" disabled={!text.trim()} onClick={importList}>Analyser la liste</button></details>
  <label>Date des règlements<input type="date" min={summary.asOf} max={today()} value={day} onChange={e=>{setDate(e.target.value);setErrors([])}} required/></label>
  {errors.length>0&&<div role="alert" className="alert error">{errors.map((error,i)=><p key={i}>{error}</p>)}</div>}
  {notice&&<p role="status" className="danz-payment-notice">{notice}</p>}
  <div className="danz-batch-list">
   {visible.map(i=>{const d=draft[i.id]||{},recv=i.kind==='receivable',surplus=recv?Math.max(0,amountOrZero(d.amount)-i.remaining):0,open=!!d.checked&&i.remaining>0;return <article key={i.id} className={'danz-batch-person danz-unified-person '+(recv?'is-in':'is-out')+(open?' is-selected':'')}>
    <button type="button" className="danz-person-trigger" disabled={!i.remaining} aria-expanded={open} onClick={()=>update(i.id,{checked:!open,amount:d.amount??(i.remaining/100).toFixed(2),allowOverpayment:false})}><span className={'danz-direction '+(recv?'danz-in':'danz-out')} aria-hidden="true">{recv?'↙':'↗'}</span><span><b>{i.label}</b><small>{!i.remaining?'Soldé':i.subtype==='overpayment'?'Avoir à rembourser':recv?'À encaisser':'À rembourser'}</small></span><strong className={recv?'danz-in':'danz-out'}>{recv?'+':'−'}{euro(i.remaining)}</strong><span aria-hidden="true">{open?'−':'›'}</span></button>
    {open&&<div className="danz-payment-edit">
      <label>{recv?'Montant reçu (€)':'Montant versé (€)'}<input aria-label={(recv?'Montant reçu de ':'Montant versé à ')+i.label} inputMode="decimal" value={d.amount||''} onChange={e=>update(i.id,{amount:e.target.value,allowOverpayment:false})}/></label>
      <button type="button" className="ghost-button danz-exact" onClick={()=>update(i.id,{amount:(i.remaining/100).toFixed(2),allowOverpayment:false})}>Montant exact</button>
      <div className="danz-methods" role="group" aria-label={'Moyen de paiement pour '+i.label}>
       {[['530','Espèces','€'],['512','Virement','↔']].map(([key,label,icon])=><button key={key} type="button" aria-pressed={d.account===key} className={d.account===key?'chosen':''} onClick={()=>update(i.id,{account:key})}><span aria-hidden="true">{icon}</span>{label}</button>)}
      </div>
      {surplus>0&&<label className="danz-overpayment"><span>Dette réglée : {euro(i.remaining)} · Avoir : {euro(surplus)}</span><span><input type="checkbox" checked={!!d.allowOverpayment} onChange={e=>update(i.id,{allowOverpayment:e.target.checked})}/> Confirmer le trop-perçu</span></label>}
      {!recv&&amountOrZero(d.amount)>i.remaining&&<p className="danz-overpayment" role="alert">Le remboursement ne peut pas dépasser le reste dû.</p>}
      <button type="button" className="primary-button danz-confirm-payment" disabled={!dateValid||!validRow(rowFor(i),i)} onClick={()=>submitRows([rowFor(i)])}>{recv?'Simuler l’encaissement':'Simuler le remboursement'} · {euro(amountOrZero(d.amount))}</button>
    </div>}
   </article>})}
  </div>
  {!visible.length&&<p className="danz-muted">Aucune opération correspondante.</p>}
  <label className="danz-settled-toggle"><input type="checkbox" checked={showSettled} onChange={e=>setShowSettled(e.target.checked)}/> Afficher aussi les opérations soldées</label>
  {selected.length>1&&<div className="danz-batch-footer"><div><small>{selected.length} sélectionné(s) · tous les noms sélectionnés</small><strong className="danz-in">+{euro(incoming)}</strong><strong className="danz-out">−{euro(outgoing)}</strong></div><button type="button" className="primary-button" disabled={!dateValid||!valid} onClick={()=>submitRows(rows)}>Simuler tout le lot</button></div>}
 </section>
}
