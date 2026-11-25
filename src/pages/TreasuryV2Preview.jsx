import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { createWorkspace, summarizeWorkspace } from '../lib/treasuryV2Workspace.js'
import './TreasuryV2Preview.css'
const euro = cents => (cents/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})
export default function TreasuryV2Preview(){
 const [workspace,setWorkspace]=useState(null)
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(true)
 const [section,setSection]=useState('home')
 const [difference,setDifference]=useState(null)
 const loadSequence=useRef(0)
 const loadReference=useCallback(async()=>{
  const seq=++loadSequence.current;setLoading(true);setError('');setWorkspace(null);setDifference(null)
  try{
   if(!supabase)throw new Error('Connexion indisponible')
   const {data,error}=await supabase.from('danz_v2_reference').select('as_of,state,reference').maybeSingle()
   if(seq!==loadSequence.current)return
   if(error)throw error
   if(!data?.reference||data.state!=='pending_review')throw new Error('Aucune référence de reprise accessible')
   const next=createWorkspace(data.reference)
   if(next.asOf!==data.as_of)throw new Error('Date de reprise incohérente')
   setWorkspace(next);setDifference(Number.isSafeInteger(data.reference.reconciliation?.unexplainedDifferenceCents)?data.reference.reconciliation.unexplainedDifferenceCents:null);
  }catch(e){if(seq===loadSequence.current)setError(e.message||'Impossible de charger la référence')}
  finally{if(seq===loadSequence.current)setLoading(false)}
 },[])
 useEffect(()=>{loadReference();return()=>{loadSequence.current++}},[loadReference])
 const summary=workspace?summarizeWorkspace(workspace):null
 
 const remaining=summary?.residuals.filter(i=>i.remaining>0)||[]
 const debtors=remaining.filter(i=>i.kind==='receivable')
 const payables=remaining.filter(i=>i.kind==='payable')
 const go=key=>setSection(key)
 const nav=[['home','Synthèse'],['settlements','Régularisations'],['journal','Journal']]
 const displayDate=summary?.asOf?.split('-').reverse().join('/')
 const metrics=summary?[
  ['bank','Banque',summary.bank,'Compte bancaire'],
  ['cash','Espèces',summary.cash,'Caisse'],
  ['receivable','À encaisser',summary.receivables,debtors.length+' personne(s)','settlements'],
  ['payable','À rembourser',summary.payables,payables.length+' dette(s)','settlements'],
  ['reserve','Après réserve',summary.afterReserve,'Hors autres engagements'],
  ['net','Situation nette',summary.net,'Après tous les règlements']
 ]:[]
 const metric=([kind,label,value,hint,target])=>{
  const body=<><span className={'danz-icon danz-icon-'+kind} aria-hidden="true">{({bank:'▤',cash:'▱',receivable:'↙',payable:'↗',reserve:'✓',net:'≈'})[kind]}</span><span className="danz-metric-label">{label}</span><strong>{euro(value)}</strong><small>{hint}</small></>
  return target?<button key={kind} type="button" className="danz-metric danz-metric-link" onClick={()=>go(target)}>{body}</button>:<article key={kind} className="danz-metric">{body}</article>
 }
 return <section className="danz-v2-preview" aria-label="Tableau de bord de trésorerie">
  <header className="danz-v2-header"><div><span className="tv2-eyebrow">DANZ · Finances</span><h2>Référence de reprise · historique</h2></div><button type="button" className="danz-refresh" disabled={loading} onClick={loadReference}>{loading?'Chargement…':'↻ Actualiser'}</button></header>
  <p className="danz-v2-warning" role="status"><strong>Référence historique · Lecture seule</strong><span>Soldes déclarés au {displayDate||'jour de reprise'}. Aucune saisie ici. Pour enregistrer un mouvement, revenir à l’onglet Trésorerie.</span></p>
  {error&&<p role="alert" className="alert error">{error}</p>}
  {!summary?<section className="danz-panel"><h3>{loading?'Chargement de la trésorerie…':'Situation indisponible'}</h3><p>{loading?'Récupération sécurisée de la référence.':'Actualiser la référence pour réessayer. Aucun solde fictif affiché.'}</p></section>:<>
   <nav className="danz-subnav" aria-label="Rubriques du tableau de bord">{nav.map(([key,label])=><button type="button" key={key} aria-current={section===key?'page':undefined} className={section===key?'active':''} onClick={()=>go(key)}>{label}</button>)}</nav>
   {section==='home'&&<>
    <section className="danz-v2-total"><span>Trésorerie de référence</span><strong>{euro(summary.available)}</strong><small>Banque + espèces · {displayDate}</small>
     {summary.bank>=0&&summary.cash>=0&&summary.available>0&&<div className="danz-balance-bar" role="img" aria-label={'Répartition : banque '+euro(summary.bank)+', espèces '+euro(summary.cash)}><span style={{width:(summary.bank/summary.available*100)+'%'}}/><span style={{width:(summary.cash/summary.available*100)+'%'}}/></div>}
     <div className="danz-balance-legend"><span>● Banque</span><span>● Espèces</span></div>
    </section>
    <div className="danz-v2-grid">{metrics.map(metric)}</div>
    <section className="danz-panel"><div className="danz-panel-heading"><div><h3>À traiter en priorité</h3><small>Suivi de la reprise</small></div></div>
      <button className="danz-action-row" type="button" onClick={()=>go('settlements')}><span className="danz-icon danz-icon-receivable" aria-hidden="true">↙</span><span><b>Paiements en attente</b><small>{debtors.length} personne(s) à régulariser</small></span><strong>{euro(summary.receivables)}</strong><span aria-hidden="true">›</span></button>
      <button className="danz-action-row" type="button" onClick={()=>go('settlements')}><span className="danz-icon danz-icon-payable" aria-hidden="true">↗</span><span><b>Remboursements</b><small>{payables.length} dette(s) à régler</small></span><strong>{euro(summary.payables)}</strong><span aria-hidden="true">›</span></button>
    </section>
    <section className="danz-panel"><h3>Contrôles financiers</h3><div className="danz-control"><span>Équilibre des écritures de reprise</span><strong className="danz-good">Équilibré</strong></div><div className="danz-control"><span>Écart de rapprochement historique</span><strong>{difference===null?'Non renseigné':euro(difference)}</strong></div><p className="danz-muted">La référence ne constitue pas un rapprochement bancaire certifié. L’écart historique est conservé séparément.</p></section>
   </>}
   {section==='settlements'&&<section className="danz-panel"><h3>Dettes et remboursements de référence</h3><p className="danz-muted">Montants à rapprocher avec les foyers réels avant toute validation.</p><ul className="danz-person-list">{remaining.slice().sort((a,b)=>a.label.localeCompare(b.label,'fr')).map(i=><li key={i.id}><div><b>{i.label}</b><small>{i.kind==='receivable'?'À encaisser':'À rembourser'}</small></div><strong>{i.kind==='receivable'?'+':'−'}{euro(i.remaining)}</strong></li>)}</ul></section>}
   {section==='journal'&&<section className="danz-panel"><h3>Journal en partie double</h3><p className="danz-muted">Écritures de reprise uniquement, pas le journal officiel.</p><div className="danz-journal">{workspace.entries.map(e=><article key={e.id}><div><b>{e.label}</b><small>{e.date.split('-').reverse().join('/')}</small></div>{e.lines.map((l,i)=><div className="danz-journal-line" key={i}><span>Compte {l.account} · {l.side==='D'?'Débit':'Crédit'}</span><strong>{euro(l.cents)}</strong></div>)}</article>)}</div></section>}
  </>}
 </section>
}
