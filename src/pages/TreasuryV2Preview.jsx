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
 const [generation,setGeneration]=useState(0)
 const loadSequence=useRef(0)
 const loadReference=useCallback(async()=>{
  const seq=++loadSequence.current;setLoading(true);setError('');setNotice('');setWorkspace(null);setOrigin('');setSimulated(false)
  try{
   if(!supabase)throw new Error('Connexion indisponible')
   const {data,error}=await supabase.from('danz_v2_reference').select('as_of,state,reference').maybeSingle()
   if(seq!==loadSequence.current)return
   if(error)throw error
   if(!data?.reference||data.state!=='pending_review')throw new Error('Aucune référence de reprise accessible')
   const next=createWorkspace(data.reference)
   if(next.asOf!==data.as_of)throw new Error('Date de reprise incohérente')
   setWorkspace(next);setOrigin('server');setDate(next.asOf);setItemId('');setAmount('');setGeneration(g=>g+1)
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
   setWorkspace(next);setOrigin('file');setSimulated(false);setGeneration(g=>g+1);setDate(next.asOf);setItemId('');setAmount('')
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
 return <section className="danz-v2-preview" aria-label="Nouveau tableau de bord de trésorerie">
  <header className="danz-v2-header"><div><span className="tv2-eyebrow">DANZ · Partie double</span><h2>Nouveau tableau de bord</h2><p>Reprise comptable et contrôle des régularisations.</p></div><span className="danz-v2-mode">Reprise privée · Lecture seule</span></header>
  <p className="danz-v2-warning" role="status">Situation de reprise déclarée, non rapprochée des mouvements ultérieurs de l’ancien journal. Aucun règlement simulé ici n’est enregistré dans Supabase. Utiliser les opérations historiques jusqu’à la bascule du moteur.</p>
  <div className="danz-v2-import"><button type="button" className="primary-button" disabled={loading} onClick={loadReference}>{loading?'Chargement…':'Actualiser la référence privée'}</button><label>Importer un fichier pour simulation (facultatif) <input type="file" accept=".json,application/json" disabled={loading} onChange={read}/></label>{workspace&&<button type="button" onClick={reset} className="ghost-button">Revenir à la référence</button>}</div>
  {error&&<p role="alert" className="alert error">{error}</p>}
  {!summary?<div className="tv2-panel"><h3>Aucune situation chargée</h3><p>La référence privée est chargée automatiquement. Si elle est indisponible, réessayer. Aucun solde fictif ne sera affiché.</p></div>:<>
    <div className="danz-v2-total"><span>Trésorerie disponible</span><strong>{euro(summary.available)}</strong><small>{simulated||origin==='file'?'Simulation locale':'Référence déclarée'} au {summary.asOf}</small></div>
    <div className="danz-v2-grid">{[['Banque',summary.bank],['Caisse espèces',summary.cash],['Créances restantes',summary.receivables],['Remboursements dus',summary.payables],['Après réserve des remboursements',summary.afterReserve],['Situation nette projetée',summary.net]].map(([label,cents])=><article key={label}><span>{label}</span><strong>{euro(cents)}</strong></article>)}</div>
    <div className="tv2-panel"><h3>Créances et remboursements</h3><div className="danz-v2-scroll"><table><thead><tr><th>Personne / référence</th><th>Nature</th><th>Initial</th><th>Restant</th></tr></thead><tbody>{summary.residuals.map(i=><tr key={i.id}><td>{i.label}</td><td>{i.kind==='receivable'?'À encaisser':'À rembourser'}</td><td>{euro(i.cents)}</td><td>{euro(i.remaining)}</td></tr>)}</tbody></table></div></div>
    <section className="tv2-panel danz-v2-form"><h3>Paiements en attente — {debtors.length} personnes</h3><p>Total restant : <strong>{euro(summary.receivables)}</strong></p><label>Rechercher une personne<input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Nom ou prénom"/></label><div className="danz-v2-scroll"><table><thead><tr><th>Personne</th><th>Montant initial</th><th>Reste dû</th><th>Statut</th></tr></thead><tbody>{visibleDebtors.map(i=><tr key={i.id}><td>{i.label}</td><td>{euro(i.cents)}</td><td>{euro(i.remaining)}</td><td>{i.remaining===i.cents?'En attente':'Partiellement réglé'}</td></tr>)}</tbody></table>{!visibleDebtors.length&&<p>Aucun paiement correspondant.</p>}</div></section>
    <TreasuryV2BatchPanel key={generation} workspace={workspace} onChange={applySimulation}/>
    <form className="tv2-panel danz-v2-form" onSubmit={submit}><h3>Simuler une régularisation</h3><label>Créance ou remboursement<select required value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">Sélectionner</option>{remaining.map(i=><option key={i.id} value={i.id}>{i.label} — {euro(i.remaining)}</option>)}</select></label><label>Montant en euros<input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0,00"/></label><label>Compte<select value={account} onChange={e=>setAccount(e.target.value)}><option value="512">Banque</option><option value="530">Espèces</option></select></label><label>Date<input type="date" min={summary.asOf} required value={date} onChange={e=>setDate(e.target.value)}/></label><button className="primary-button" disabled={!remaining.length}>Simuler le règlement</button>{notice&&<p role="status">{notice}</p>}</form>
    <div className="tv2-panel"><h3>Journal en partie double</h3><div className="danz-v2-scroll"><table><thead><tr><th>Date</th><th>Opération</th><th>Compte</th><th>Débit</th><th>Crédit</th></tr></thead><tbody>{workspace.entries.flatMap(e=>e.lines.map((l,i)=><tr key={e.id+':'+i}><td>{e.date}</td><td>{e.label}</td><td>{l.account}</td><td>{l.side==='D'?euro(l.cents):'—'}</td><td>{l.side==='C'?euro(l.cents):'—'}</td></tr>))}</tbody></table></div><p>Chaque opération est équilibrée et le total des créances et dettes est rapproché du journal.</p></div>
  </>}
 </section>
}
