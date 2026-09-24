import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatMoney } from '../lib/finance.js'
import { accountFor } from '../lib/treasuryLedger.js'
import '../treasury-journal.css'

const categoryLabels = {
  courses: 'Courses / alimentation', materiel: 'Matériel / équipement', evenement: 'Événement',
  transport: 'Transport', frais_bancaires: 'Frais bancaires', fonctionnement: 'Fonctionnement',
  autre: 'Autre dépense', membership: 'Cotisation', don: 'Don', subvention: 'Subvention'
}
const methodLabels = { unassigned: 'À affecter', bank_transfer: 'Compte bancaire', card: 'Compte bancaire / carte', cash: 'Caisse (liquide)', personal_advance: 'Avance personnelle' }
const dateText = (value) => value ? new Date(value).toLocaleDateString('fr-FR') : '—'
const day = (value) => value ? new Date(value).toISOString().slice(0,10) : ''
const cents = (value) => {
  const normalized = String(value ?? '').replace(/\s/g,'').replace(',','.')
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized)*100) : NaN
}
const personKey = (e) => {
  if (e.payment_method === 'personal_advance') return e.advanced_by_offline ? 'offline:'+e.advanced_by_offline : e.advanced_by ? 'user:'+e.advanced_by : ''
  return e.beneficiary_offline_id ? 'offline:'+e.beneficiary_offline_id : e.beneficiary_user_id ? 'user:'+e.beneficiary_user_id : ''
}
const personIds = (s) => ({p_user_id:s.startsWith('user:')?s.slice(5):null,p_offline_id:s.startsWith('offline:')?s.slice(8):null})

export default function TreasuryJournalManager({data,onReload,onReceipt}) {
  const [query,setQuery] = useState('')
  const [mode,setMode] = useState('unassigned')
  const [editing,setEditing] = useState(null)
  const [busy,setBusy] = useState('')
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const entries=data.entries || []
  const households = Object.fromEntries((data.households || []).map((h)=>[h.id,h.name]))
  const people=useMemo(()=>[
    ...(data.profiles || []).filter((p)=>p.active).map((p)=>({id:'user:'+p.id,label:p.full_name || p.email,kind:'Compte'})),
    ...(data.offline || []).filter((p)=>!p.linked_user_id).map((p)=>({id:'offline:'+p.id,label:p.display_name,kind:'Sans compte'}))
  ].sort((a,b)=>a.label.localeCompare(b.label,'fr')),[data])
  const peopleById=Object.fromEntries(people.map((p)=>[p.id,p]))
  const otherById=Object.fromEntries((data.offline||[]).filter((p)=>p.linked_user_id).map((p)=>['offline:'+p.id,{label:(data.profiles||[]).find((u)=>u.id===p.linked_user_id)?.full_name||p.display_name}]))
  const personName=(e)=>peopleById[personKey(e)]?.label || otherById[personKey(e)]?.label || (e.household_payment_id ? 'Foyer / cotisation' : 'Non attribué')
  const filtered=entries.filter((e)=>{
    const matches=mode==='all'||(mode==='unassigned'&&e.payment_method==='unassigned')
      ||(mode==='bank'&&accountFor(e)==='bank'&&e.payment_method!=='personal_advance')
      ||(mode==='cash'&&accountFor(e)==='cash'&&e.payment_method!=='personal_advance')
      ||(mode==='advances'&&e.payment_method==='personal_advance')
    return matches && (e.label+' '+(e.note||'')+' '+personName(e)).toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr'))
  }).sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at) || Number(b.source_row||0)-Number(a.source_row||0))
  const unassigned=entries.filter((e)=>e.payment_method==='unassigned'&&e.status==='settled')
  const lastImport=(data.importBatches||[])[0]
  const getCategory=(e)=>e.category ?? null
  const params=(e,changes={})=>({
    p_id:e.id,p_label:e.label,p_note:e.note || '',p_category:getCategory(e),
    p_method:e.payment_method,...personIds(personKey(e)),p_amount_cents:Number(e.amount_cents),
    p_occurred_on:day(e.occurred_at),p_event_id:e.event_id||null,...changes
  })
  const run=async(id,params,message)=>{
    if(busy)return false
    setBusy(id);setError('');setNotice('')
    try {
      const {error:e}=await supabase.rpc('treasury_update_entry',params)
      if(e)throw e
      await onReload()
      setNotice(message)
      return true
    } catch(e){setError(e.message || 'Modification non enregistrée.');return false}
    finally{setBusy('')}
  }
  const reclassify=async(e,method)=>{
    if(e.payment_method===method)return
    const newMethod=method==='bank'?'bank_transfer':method
    await run(e.id,params(e,{p_method:newMethod}),
      'Compte mis à jour pour « '+e.label+' ». Les soldes sont recalculés.')
  }
  const open=(e)=>{
    setError('');setNotice('')
    setEditing({...e,editLabel:e.label,editNote:e.note||'',editCategory:getCategory(e)||'autre',
      editAmount:(e.amount_cents/100).toFixed(2).replace('.',','),editMethod:e.payment_method,
      editPerson:personKey(e),editDate:day(e.occurred_at),editEvent:e.event_id||''})
  }
  const set=(key,value)=>setEditing((old)=>({...old,[key]:value}))
  const save=async(event)=>{
    event.preventDefault()
    if(!editing)return
    const value=cents(editing.editAmount)
    if(!Number.isSafeInteger(value)||value<=0){setError('Montant invalide : deux décimales maximum.');return}
    const changes={
      p_label:editing.editLabel.trim(),p_note:editing.editNote,p_category:linked?editing.category:editing.editCategory,
      p_method:editing.editMethod,p_amount_cents:value,p_occurred_on:editing.editDate,
      p_event_id:linked?(editing.event_id||null):(editing.editEvent||null),...personIds(linked?personKey(editing):editing.editPerson)
    }
    const ok=await run(editing.id,params(editing,changes),'Écriture corrigée et modification enregistrée dans l’historique.')
    if(ok)setEditing(null)
  }
  const linked=Boolean(editing?.household_payment_id)
  const advance=editing?.payment_method==='personal_advance'
  return <section className="tj">
    <header className="tj-header">
      <div><span className="tv2-eyebrow">Grand livre modifiable</span><h2>Mes écritures et mes comptes</h2>
        <p>Répartissez les mouvements entre la banque et les espèces. Corrigez les descriptions, montants et personnes sans perdre l’écriture d’origine.</p></div>
      <span className="tj-total">{entries.length} écritures</span>
    </header>
    {lastImport && <div className="tj-import"><div><strong>Reprise du fichier Excel · {lastImport.exercise}</strong>
      <span>{lastImport.membership_count} cotisations · {formatMoney(lastImport.confirmed_closing_cents)} confirmé dans le fichier</span>
      <small>Compte bancaire et caisse à renseigner selon vos justificatifs. Une opération classée « À affecter » ne leur est pas attribuée automatiquement.</small></div>
      <span className="tj-pending">{unassigned.length} à affecter</span></div>}
    {error && <div className="alert error" role="alert">{error}<button onClick={()=>setError('')} type="button">×</button></div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    <div className="tj-filters"><input aria-label="Rechercher des écritures" type="search" placeholder="Libellé, personne, note…" value={query} onChange={(e)=>setQuery(e.target.value)}/>
      <select aria-label="Filtrer les comptes" value={mode} onChange={(e)=>setMode(e.target.value)}>
        <option value="unassigned">À affecter ({unassigned.length})</option><option value="all">Toutes les écritures</option>
        <option value="bank">Compte bancaire</option><option value="cash">Caisse (liquide)</option><option value="advances">Avances personnelles</option>
      </select></div>
    <div className="tj-table"><div className="tj-row tj-row-head"><span>Date / origine</span><span>Écriture / personne</span><span>Montant</span><span>Compte</span><span>Action</span></div>
      {filtered.map((e)=>{
        const canSetMethod = e.payment_method!=='personal_advance'&&e.status==='settled'
        return <div className={'tj-row '+(e.payment_method==='unassigned'?'tj-row-pending':'')} key={e.id}>
          <div className="tj-date">{dateText(e.occurred_at)}
            {e.import_batch_id&&<small>Excel · ligne {e.source_row}</small>}
            {e.needs_review&&<span className="tj-alert">Date à vérifier</span>}
          </div>
          <div className="tj-description"><strong>{e.label}</strong><small>{personName(e)}{e.note?' · '+e.note:''}</small>
            {e.source_date && e.needs_review &&<small>Excel : {e.source_date} (date d’origine conservée)</small>}
          </div>
          <strong className={'tj-amount '+(e.kind==='income'?'incoming':'')}>{e.kind==='income'?'+ ':'− '}{formatMoney(e.amount_cents)}</strong>
          <div className="tj-method">{canSetMethod?<select aria-label={'Compte de '+e.label} disabled={Boolean(busy)} value={e.payment_method} onChange={(ev)=>reclassify(e,ev.target.value)}>
            <option value="unassigned">À affecter</option><option value="bank_transfer">Compte bancaire</option><option value="cash">Caisse (liquide)</option>
            {e.payment_method==='card'&&<option value="card">Carte bancaire</option>}
          </select>:<span>{methodLabels[e.payment_method]||e.payment_method}</span>}</div>
          <div className="tj-actions"><button type="button" disabled={Boolean(busy)} onClick={()=>open(e)}>Modifier</button>
            {e.receipt_storage_path&&<button type="button" onClick={()=>onReceipt(e)}>Justif.</button>}
          </div></div>
      })}
      {!filtered.length&&<div className="tj-empty">Aucune opération pour ce filtre.</div>}
    </div>
    <p className="tv2-hint">Les cotisations déjà encaissées restent rattachées au bénéficiaire et à son foyer. Pour les fiches sans compte, le rapprochement se fait dans « Membres & accès ». Les avances sont modifiables ici et remboursables séparément.</p>
    {Boolean((data.importArchive||[]).length)&&<details className="tj-archive"><summary>Archives du bilan antérieur · {(data.importArchive||[]).length} lignes non datées</summary>
      <p>Ces montants sont conservés à titre d’archive : ils ne sont pas déduits une seconde fois du report initial de l’exercice 2026-2027.</p>
      <div className="tj-archive-grid"><strong>Recettes</strong><strong>Dépenses</strong>
        {data.importArchive.map((row)=><div className="tj-archive-pair" key={row.batch_id+':'+row.source_row}>
          <span>{row.income_label||'—'} <b>{row.income_cents!=null?formatMoney(row.income_cents):''}</b></span>
          <span>{row.expense_label||'—'} <b>{row.expense_cents!=null?formatMoney(row.expense_cents):''}</b></span>
        </div>)}</div>
    </details>}
    {editing&&<div className="tj-editor-backdrop" role="presentation" onClick={()=>setEditing(null)}>
      <div className="tj-editor" role="dialog" aria-modal="true" aria-label="Modifier une écriture" onClick={(e)=>e.stopPropagation()}>
        <header><div><span className="tv2-eyebrow">Correction tracée</span><h2>Modifier une écriture</h2><small>{editing.import_batch_id?'Issue du fichier Excel, ligne '+editing.source_row:'Écriture du site'}</small></div>
          <button type="button" aria-label="Fermer" onClick={()=>setEditing(null)}>×</button></header>
        <form onSubmit={save}><label>Libellé<input autoFocus required maxLength={250} value={editing.editLabel} onChange={(e)=>set('editLabel',e.target.value)}/></label>
          <label>Description détaillée<textarea rows={3} value={editing.editNote} onChange={(e)=>set('editNote',e.target.value)}/></label>
          <div className="tj-editor-grid">
            <label>Montant (€)<input inputMode="decimal" required disabled={linked} value={editing.editAmount} onChange={(e)=>set('editAmount',e.target.value)}/></label>
            <label>Date comptable<input type="date" max={new Date().toISOString().slice(0,10)} required value={editing.editDate} onChange={(e)=>set('editDate',e.target.value)}/></label>
          </div>
          <div className="tj-editor-grid">
            <label>Catégorie<select value={editing.editCategory} disabled={linked} onChange={(e)=>set('editCategory',e.target.value)}>
              {[...new Set([editing.editCategory,...Object.keys(categoryLabels)])].map((k)=><option key={k} value={k}>{categoryLabels[k]||k}</option>)}</select></label>
            <label>Compte<select disabled={advance} value={editing.editMethod} onChange={(e)=>set('editMethod',e.target.value)}>
              {advance?<option value="personal_advance">Avance personnelle</option>:<>
                <option value="unassigned">À affecter</option><option value="bank_transfer">Compte bancaire</option>
                <option value="cash">Caisse (liquide)</option>{editing.editMethod==='card'&&<option value="card">Carte bancaire</option>}
              </>}</select></label>
          </div>
          <label>{advance?'Personne ayant avancé':'Personne bénéficiaire / à qui attribuer'}<select disabled={linked} value={editing.editPerson} onChange={(e)=>set('editPerson',e.target.value)}>
            <option value="">Sans attribution individuelle</option>{people.map((p)=><option key={p.id} value={p.id}>{p.label} · {p.kind}</option>)}
          </select></label>
          {linked&&<p className="tv2-hint">Cotisation déjà reçue : la personne et le montant sont verrouillés pour préserver le paiement enregistré. Le compte et la description restent modifiables.</p>}
          <label>Événement<select disabled={linked} value={editing.editEvent} onChange={(e)=>set('editEvent',e.target.value)}>
            <option value="">Sans événement</option>{(data.events||[]).map((ev)=><option key={ev.id} value={ev.id}>{ev.title}</option>)}
          </select></label>
          {editing.needs_review&&<p className="tj-alert">Date Excel d’origine : {editing.source_date}. La date comptable provisoire a été placée au jour de l’import pour respecter le solde confirmé.</p>}
          <footer><button type="button" className="ghost-button" onClick={()=>setEditing(null)}>Annuler</button>
            <button type="submit" className="primary-button" disabled={Boolean(busy)}>{busy?'Enregistrement…':'Enregistrer les corrections'}</button></footer>
        </form></div>
    </div>}
  </section>
}
