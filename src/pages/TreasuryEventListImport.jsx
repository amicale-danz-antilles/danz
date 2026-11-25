import { useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { eventPeople, eventChargePersonKey } from '../lib/eventFinance.js'
import { chargeResidualCents, formatMoney } from '../lib/finance.js'
import { parseEuros } from '../lib/treasuryV2Workspace.js'
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(' ').sort().join(' ')
const parseLines=(input,people)=>input.split(/\r?\n/).filter(l=>l.trim()).map((line,index)=>{
 const match=line.trim().replace(/^[-•*]\s*/,'').match(/^(.+?)(?:\s*[:;\t]\s*|\s+)(\d+(?:[,.]\d{1,2})?)\s*(?:€|EUR)?$/i)
 if(!match)return {id:index,name:line,amount:'',key:'',error:'Format attendu : NOM Prénom : 12,50 €'}
 const choices=people.filter(p=>normalize(p.name)===normalize(match[1]))
 return {id:index,name:match[1],amount:match[2],key:choices.length===1?choices[0].key:'',error:''}
})
export default function TreasuryEventListImport({data,onReload,onEvents}){
 const {people,byKey}=useMemo(()=>eventPeople(data),[data])
 const [eventId,setEventId]=useState(''),[label,setLabel]=useState(''),[input,setInput]=useState(''),[rows,setRows]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[committed,setCommitted]=useState(false)
 const pending=useRef(null),lock=useRef(false)
 const eligible=people.filter(p=>p.householdId).sort((a,b)=>a.name.localeCompare(b.name,'fr'))
 const existingDue=p=>(data.charges||[]).filter(c=>c.status==='open'&&byKey[eventChargePersonKey(c)]?.key===p.key).reduce((s,c)=>s+chargeResidualCents(c,data.allocations||[],data.payments||[]),0)
 const event=data.events.find(e=>e.id===eventId),chargeLabel=label.trim()||event?.title||''
 const seen=new Set()
 const checked=rows.map(row=>{
  const p=byKey[row.key];let cents=0,problem=''
  try{cents=parseEuros(row.amount)}catch{problem='Montant invalide'}
  if(!p?.householdId)problem='Choisir une personne avec foyer'
  else if(seen.has(p.key))problem='Personne présente deux fois'
  else if((data.charges||[]).some(c=>c.event_id===eventId&&c.status!=='cancelled'&&byKey[eventChargePersonKey(c)]?.key===p.key&&c.label===chargeLabel))problem='Dette de même libellé déjà créée pour cet événement'
  if(p)seen.add(p.key)
  if(cents>100000000)problem='Montant trop élevé'
  return {...row,p,cents,problem,previous:p?existingDue(p):0}
 })
 const total=checked.reduce((s,r)=>s+r.cents,0)
 const valid=!!event&&chargeLabel.length>0&&chargeLabel.length<=180&&checked.length>0&&checked.length<=100&&checked.every(r=>!r.problem)
 const edit=(fn)=>{if(lock.current||pending.current)return;setError('');setNotice('');setCommitted(false);fn()}
 const submit=async()=>{
  if(lock.current||committed||(!valid&&!pending.current))return
  if(!pending.current){
   if(!window.confirm('Créer définitivement '+checked.length+' dette(s) pour '+formatMoney(total)+' ? Les foyers seront mis à jour. Aucun argent ne sera encaissé.'))return
   pending.current={p_event_id:eventId,p_batch_id:crypto.randomUUID(),p_rows:checked.map(r=>({person_type:r.p.type,person_id:r.p.id,amount_cents:r.cents,label:chargeLabel,category:'activity',membership:false}))}
  }
  lock.current=true;setBusy(true);setError('')
  try{
   const {data:result,error:e}=await supabase.rpc('treasury_assign_event_charges',pending.current)
   if(e)throw e
   setCommitted(true);pending.current=null;setRows([]);setInput('');setNotice((result?.new_charges??'Les')+' dette(s) enregistrée(s) dans les foyers.')
   try{await onReload()}catch{setNotice('Dettes enregistrées. Actualiser la page pour recharger les soldes.')}
  }catch(e){setError((e.message||'Enregistrement non confirmé')+' — Réessayer le même lot sans modifier les lignes, afin d’éviter un doublon.')}
  finally{lock.current=false;setBusy(false)}
 }
 const frozen=busy||!!pending.current
 return <section className="danz-v2-preview"><section className="danz-panel danz-v2-form">
  <div className="danz-panel-heading"><div><h3>Nouvelle liste de dettes</h3><small>Enregistrement réel · Affectation aux foyers</small></div></div>
  <label>Événement<select disabled={frozen} value={eventId} onChange={e=>edit(()=>setEventId(e.target.value))}><option value="">Choisir un événement</option>{data.events.map(e=><option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
  <button type="button" className="ghost-button" disabled={frozen} onClick={onEvents}>Créer ou gérer un événement</button>
  <label>Libellé des frais (facultatif)<input disabled={frozen} maxLength={180} value={label} onChange={e=>edit(()=>setLabel(e.target.value))} placeholder="Ex. participation au repas"/></label>
  <label>Coller les noms et montants<textarea disabled={frozen} rows={5} value={input} onChange={e=>edit(()=>{setInput(e.target.value);setRows([])})} placeholder={'NOM Prénom : 12,50 €\nAutre Nom : 8 €'}/></label>
  <button type="button" className="primary-button" disabled={frozen||!input.trim()} onClick={()=>edit(()=>setRows(parseLines(input,eligible)))}>Analyser la liste</button>
  <button type="button" className="ghost-button" disabled={frozen||rows.length>=100} onClick={()=>edit(()=>setRows(old=>[...old,{id:Math.max(-1,...old.map(r=>r.id))+1,name:'',amount:'',key:''}]))}>+ Ajouter une personne</button>
  {checked.map(r=><article className="danz-batch-person danz-unified-person is-in danz-v2-form" key={r.id}>
   <b>{r.name||'Nouvelle ligne'}</b>
   <label>Personne / foyer<select disabled={frozen} value={r.key} onChange={e=>edit(()=>setRows(old=>old.map(x=>x.id===r.id?{...x,key:e.target.value}:x)))}><option value="">Choisir / vérifier la personne</option>{eligible.map(p=><option key={p.key} value={p.key}>{p.name} · {p.householdName}</option>)}</select></label>
   <label>Montant (€)<input disabled={frozen} inputMode="decimal" value={r.amount} onChange={e=>edit(()=>setRows(old=>old.map(x=>x.id===r.id?{...x,amount:e.target.value}:x)))}/></label>
   {r.p&&<div className="danz-unified-totals"><div><small>Dette actuelle</small><strong>{formatMoney(r.previous)}</strong></div><div><small>Après ajout</small><strong>{formatMoney(r.previous+r.cents)}</strong></div></div>}
   {r.problem&&<p role="alert" className="danz-muted">{r.problem}</p>}
   <button type="button" disabled={frozen} className="ghost-button" onClick={()=>edit(()=>setRows(old=>old.filter(x=>x.id!==r.id)))}>Retirer cette ligne</button>
  </article>)}
  {rows.length>0&&<div className="danz-batch-footer"><div><small>{rows.length} ligne(s) · nouvelles dettes</small><strong>{formatMoney(total)}</strong></div><button type="button" className="primary-button" disabled={busy||committed||(!valid&&!pending.current)} onClick={submit}>{busy?'Enregistrement…':pending.current?'Réessayer le même lot':'Enregistrer les dettes'}</button></div>}
  {error&&<p className="alert error" role="alert">{error}</p>}{notice&&<p className="alert success" role="status">{notice}</p>}
  <p className="danz-muted">Une dette ajoute un montant dû au foyer, sans augmenter les soldes banque ou espèces. Seul un paiement confirmé augmente la trésorerie.</p>
 </section></section>
}
