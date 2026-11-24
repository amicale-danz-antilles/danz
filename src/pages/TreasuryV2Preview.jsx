import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { createWorkspace, summarizeWorkspace, simulateSettlement, parseEuros } from '../lib/treasuryV2Workspace.js'
import './TreasuryV2Preview.css'
import TreasuryV2BatchPanel from './TreasuryV2BatchPanel.jsx'
const euro = cents => (cents/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})
export default function TreasuryV2Preview(){
 const [workspace,setWorkspace]=useState(null)
 const [error,setError]=useState('')
 const [itemId,setItemId]=useState('')
 const [amount,setAmount]=useState('')
 const [account,setAccount]=useState('512')
 const [date,setDate]=useState('')
 const [notice,setNotice]=useState('')
 const [loading,setLoading]=useState(true)
 const [origin,setOrigin]=useState('')
 const [simulated,setSimulated]=useState(false)
 const [filter,setFilter]=useState('')
 const [section,setSection]=useState('home')
 const [difference,setDifference]=useState(null)
 const [generation,setGeneration]=useState(0)
 const loadSequence=useRef(0)
 const loadReference=useCallback(async()=>{
  const seq=++loadSequence.current;setLoading(true);setError('');setNotice('');setWorkspace(null);setOrigin('');setSimulated(false);setDifference(null)
  try{
   if(!supabase)throw new Error('Connexion indisponible')
   const {data,error}=await supabase.from('danz_v2_reference').select('as_of,state,reference').maybeSingle()
   if(seq!==loadSequence.current)return
   if(error)throw error
   if(!data?.reference||data.state!=='pending_review')throw new Error('Aucune référence de reprise accessible')
   const next=createWorkspace(data.reference)
   if(next.asOf!==data.as_of)throw new Error('Date de reprise incohérente')
   setWorkspace(next);setDifference(Number.isSafeInteger(data.reference.reconciliation?.unexplainedDifferenceCents)?data.reference.reconciliation.unexplainedDifferenceCents:null);setOrigin('server');setDate(next.asOf);setItemId('');setAmount('');setGeneration(g=>g+1)
  }catch(e){if(seq===loadSequence.current)setError(e.message||'Impossible de charger la référence')}
  finally{if(seq===loadSequence.current)setLoading(false)}
 },[])
 useEffect(()=>{loadReference();return()=>{loadSequence.current++}},[loadReference])
 const summary=workspace?summarizeWorkspace(workspace):null
 const reset=()=>{loadReference()}
 const applySimulation=next=>{setWorkspace(next);setSimulated(true)}
 const read=async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return
  const seq=++loadSequence.current;setLoading(true);setError('');setNotice('')
  try{
   if(file.size>250000)throw new Error('Fichier trop volumineux')
   const next=createWorkspace(JSON.parse(await file.text()))
   if(seq!==loadSequence.current)return
   setWorkspace(next);setDifference(null);setOrigin('file');setSimulated(false);setGeneration(g=>g+1);setDate(next.asOf);setItemId('');setAmount('')
  }catch(e){if(seq===loadSequence.current)setError(e.message||'Fichier non valide')}
  finally{if(seq===loadSequence.current)setLoading(false)}
 }
 const submit=event=>{
  event.preventDefault();setError('');setNotice('')
  try{
   const next=simulateSettlement(workspace,{id:crypto.randomUUID(),itemId,cents:parseEuros(amount),account,date})
   applySimulation(next);setItemId('');setAmount('');setNotice('Simulation enregistrée dans cet aperçu uniquement.')
  }catch(e){setError(e.message)}
 }
 const remaining=summary?.residuals.filter(i=>i.remaining>0)||[]
 const debtors=remaining.filter(i=>i.kind==='receivable')
 const visibleDebtors=debtors.filter(i=>i.label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(filter.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase())).sort((a,b)=>a.label.localeCompare(b.label,'fr'))
 const isSimulation=simulated||origin==='file'
 const payables=remaining.filter(i=>i.kind==='payable')
 const go=key=>{setSection(key);setNotice('')}
 const nav=[['home','Synthèse'],['receipts','À encaisser'],['refunds','À rembourser'],['journal','Journal']]
 const displayDate=summary?.asOf?.split('-').reverse().join('/')
 const metrics=summary?[
  ['bank','Banque',summary.bank,'Compte bancaire'],
  ['cash','Espèces',summary.cash,'Caisse'],
  ['receivable','À encaisser',summary.receivables,debtors.length+' personne(s)','receipts'],
  ['payable','À rembourser',summary.payables,payables.length+' dette(s)','refunds'],
  ['reserve','Après réserve',summary.afterReserve,'Hors autres engagements'],
  ['net','Situation nette',summary.net,'Après tous les règlements']
 ]:[]
 const metric=([kind,label,value,hint,target])=>{
  const body=<><span className={'danz-icon danz-icon-'+kind} aria-hidden="true">{({bank:'▤',cash:'▱',receivable:'↙',payable:'↗',reserve:'✓',net:'≈'})[kind]}</span><span className="danz-metric-label">{label}</span><strong>{euro(value)}</strong><small>{hint}</small></>
  return target?<button key={kind} type="button" className="danz-metric danz-metric-link" onClick={()=>go(target)}>{body}</button>:<article key={kind} className="danz-metric">{body}</article>
 }
 return <section className="danz-v2-preview" aria-label="Tableau de bord de trésorerie">
  <header className="danz-v2-header"><div><span className="tv2-eyebrow">DANZ · Finances</span><h2>Tableau de bord</h2></div><button type="button" className="danz-refresh" disabled={loading} onClick={loadReference}>{loading?'Chargement…':'↻ Actualiser'}</button></header>
  <p className={'danz-v2-warning'+(isSimulation?' is-simulation':'')} role="status"><strong>{isSimulation?'Simulation locale':'Référence de reprise · Lecture seule'}</strong><span>{isSimulation?'Les montants affichés sont simulés. Aucun règlement n’est enregistré.':'Soldes déclarés au '+(displayDate||'jour de reprise')+'. Les mouvements ultérieurs restent dans l’ancien journal.'}</span></p>
  {error&&<p role="alert" className="alert error">{error}</p>}
  {!summary?<section className="danz-panel"><h3>{loading?'Chargement de la trésorerie…':'Situation indisponible'}</h3><p>{loading?'Récupération sécurisée de la référence.':'Actualiser la référence pour réessayer. Aucun solde fictif affiché.'}</p></section>:<>
   <nav className="danz-subnav" aria-label="Rubriques du tableau de bord">{nav.map(([key,label])=><button type="button" key={key} aria-current={section===key?'page':undefined} className={section===key?'active':''} onClick={()=>go(key)}>{label}</button>)}</nav>
   {section==='home'&&<>
    <section className="danz-v2-total"><span>Trésorerie {isSimulation?'simulée':'de référence'}</span><strong>{euro(summary.available)}</strong><small>Banque + espèces · {displayDate}</small>
     {summary.bank>=0&&summary.cash>=0&&summary.available>0&&<div className="danz-balance-bar" role="img" aria-label={'Répartition : banque '+euro(summary.bank)+', espèces '+euro(summary.cash)}><span style={{width:(summary.bank/summary.available*100)+'%'}}/><span style={{width:(summary.cash/summary.available*100)+'%'}}/></div>}
     <div className="danz-balance-legend"><span>● Banque</span><span>● Espèces</span></div>
    </section>
    <div className="danz-v2-grid">{metrics.map(metric)}</div>
    <section className="danz-panel"><div className="danz-panel-heading"><div><h3>À traiter en priorité</h3><small>Suivi de la reprise</small></div></div>
      <button className="danz-action-row" type="button" onClick={()=>go('receipts')}><span className="danz-icon danz-icon-receivable" aria-hidden="true">↙</span><span><b>Paiements en attente</b><small>{debtors.length} personne(s) à régulariser</small></span><strong>{euro(summary.receivables)}</strong><span aria-hidden="true">›</span></button>
      <button className="danz-action-row" type="button" onClick={()=>go('refunds')}><span className="danz-icon danz-icon-payable" aria-hidden="true">↗</span><span><b>Remboursements</b><small>{payables.length} dette(s) à régler</small></span><strong>{euro(summary.payables)}</strong><span aria-hidden="true">›</span></button>
    </section>
    <section className="danz-panel"><h3>Contrôles financiers</h3><div className="danz-control"><span>Équilibre des écritures de l’aperçu</span><strong className="danz-good">Équilibré</strong></div><div className="danz-control"><span>Écart de rapprochement historique</span><strong>{difference===null?'Non renseigné':euro(difference)}</strong></div><p className="danz-muted">La référence ne constitue pas un rapprochement bancaire certifié. L’écart historique est conservé séparément.</p></section>
   </>}
   {section==='receipts'&&<>
    <section className="danz-panel"><div className="danz-panel-heading"><div><h3>Paiements en attente</h3><small>{debtors.length} personne(s)</small></div><strong className="danz-section-total">{euro(summary.receivables)}</strong></div><label className="danz-field">Rechercher une personne<input type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Nom ou prénom"/></label><ul className="danz-person-list">{visibleDebtors.map(i=><li key={i.id}><div><b>{i.label}</b><small>{i.remaining===i.cents?'En attente':'Partiellement réglé · initial '+euro(i.cents)}</small></div><strong>{euro(i.remaining)}</strong></li>)}</ul>{!visibleDebtors.length&&<p>Aucun paiement correspondant.</p>}</section>
    <TreasuryV2BatchPanel key={generation} workspace={workspace} onChange={applySimulation}/>
   </>}
   {section==='refunds'&&<section className="danz-panel"><div className="danz-panel-heading"><h3>Remboursements dus</h3><strong className="danz-section-total">{euro(summary.payables)}</strong></div><ul className="danz-person-list">{payables.map(i=><li key={i.id}><div><b>{i.label}</b><small>À rembourser</small></div><strong>{euro(i.remaining)}</strong></li>)}</ul>{!payables.length&&<p>Aucun remboursement en attente.</p>}
    <form className="danz-v2-form" onSubmit={submit}><h3>Simuler un remboursement</h3><label>Personne<select required value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">Sélectionner</option>{payables.map(i=><option key={i.id} value={i.id}>{i.label} — {euro(i.remaining)}</option>)}</select></label><label>Montant en euros<input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0,00"/></label><label>Compte<select value={account} onChange={e=>setAccount(e.target.value)}><option value="512">Banque</option><option value="530">Espèces</option></select></label><label>Date<input type="date" min={summary.asOf} required value={date} onChange={e=>setDate(e.target.value)}/></label><button className="primary-button" disabled={!payables.length||!payables.some(i=>i.id===itemId)}>Simuler le remboursement</button>{notice&&<p role="status">{notice}</p>}</form>
   </section>}
   {section==='journal'&&<section className="danz-panel"><h3>Journal en partie double</h3><p className="danz-muted">Écritures de reprise et simulations uniquement, pas le journal officiel.</p><div className="danz-journal">{workspace.entries.map(e=><article key={e.id}><div><b>{e.label}</b><small>{e.date.split('-').reverse().join('/')}</small></div>{e.lines.map((l,i)=><div className="danz-journal-line" key={i}><span>Compte {l.account} · {l.side==='D'?'Débit':'Crédit'}</span><strong>{euro(l.cents)}</strong></div>)}</article>)}</div></section>}
  </>}
  <details className="danz-panel danz-tools"><summary>Outils de simulation</summary><p className="danz-muted">Importer un fichier privé pour une simulation facultative. Les données ne sont pas enregistrées.</p><label className="danz-field">Fichier JSON<input type="file" accept=".json,application/json" disabled={loading} onChange={read}/></label><button type="button" className="ghost-button" disabled={loading} onClick={reset}>Revenir à la référence</button></details>
 </section>
}
