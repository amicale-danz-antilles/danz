import { useState } from 'react'
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
 const [loading,setLoading]=useState(false)
 const summary=workspace?summarizeWorkspace(workspace):null
 const reset=()=>{setWorkspace(null);setError('');setNotice('');setItemId('');setAmount('');setDate('')}
 const read=async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return
  setLoading(true);setError('');setNotice('')
  try{
   if(file.size>250000)throw new Error('Fichier trop volumineux')
   const next=createWorkspace(JSON.parse(await file.text()))
   setWorkspace(next);setDate(next.asOf);setItemId('');setAmount('')
  }catch(e){setError(e.message||'Fichier non valide')}
  finally{setLoading(false)}
 }
 const submit=event=>{
  event.preventDefault();setError('');setNotice('')
  try{
   const next=simulateSettlement(workspace,{id:crypto.randomUUID(),itemId,cents:parseEuros(amount),account,date})
   setWorkspace(next);setItemId('');setAmount('');setNotice('Simulation enregistrée dans cet aperçu uniquement.')
  }catch(e){setError(e.message)}
 }
 const remaining=summary?.residuals.filter(i=>i.remaining>0)||[]
 return <section className="danz-v2-preview" aria-label="Nouveau tableau de bord de trésorerie">
  <header className="danz-v2-header"><div><span className="tv2-eyebrow">DANZ · Partie double</span><h2>Nouveau tableau de bord</h2><p>Reprise comptable et contrôle des régularisations.</p></div><span className="danz-v2-mode">Aperçu privé · Non déployé</span></header>
  <p className="danz-v2-warning" role="status">Environnement de préparation : aucun règlement de cet écran n'est transmis à la banque ni enregistré dans Supabase. Les données importées restent en mémoire jusqu'à la fermeture de la page.</p>
  <div className="danz-v2-import"><label>Charger une référence de reprise JSON <input type="file" accept=".json,application/json" disabled={loading} onChange={read}/></label>{workspace&&<button type="button" onClick={reset} className="ghost-button">Effacer l'aperçu</button>}</div>
  {error&&<p role="alert" className="alert error">{error}</p>}
  {!summary?<div className="tv2-panel"><h3>Aucune situation chargée</h3><p>Importer le fichier privé de reprise validé par le trésorier. Aucun solde fictif ne sera affiché.</p></div>:<>
    <div className="danz-v2-total"><span>Trésorerie disponible</span><strong>{euro(summary.available)}</strong><small>Situation simulée au {summary.asOf}</small></div>
    <div className="danz-v2-grid">{[['Banque',summary.bank],['Caisse espèces',summary.cash],['Créances restantes',summary.receivables],['Remboursements dus',summary.payables],['Après réserve des remboursements',summary.afterReserve],['Situation nette projetée',summary.net]].map(([label,cents])=><article key={label}><span>{label}</span><strong>{euro(cents)}</strong></article>)}</div>
    <div className="tv2-panel"><h3>Créances et remboursements</h3><div className="danz-v2-scroll"><table><thead><tr><th>Personne / référence</th><th>Nature</th><th>Initial</th><th>Restant</th></tr></thead><tbody>{summary.residuals.map(i=><tr key={i.id}><td>{i.label}</td><td>{i.kind==='receivable'?'À encaisser':'À rembourser'}</td><td>{euro(i.cents)}</td><td>{euro(i.remaining)}</td></tr>)}</tbody></table></div></div>
    <TreasuryV2BatchPanel key={workspace.asOf} workspace={workspace} onChange={setWorkspace}/>
    <form className="tv2-panel danz-v2-form" onSubmit={submit}><h3>Simuler une régularisation</h3><label>Créance ou remboursement<select required value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">Sélectionner</option>{remaining.map(i=><option key={i.id} value={i.id}>{i.label} — {euro(i.remaining)}</option>)}</select></label><label>Montant en euros<input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0,00"/></label><label>Compte<select value={account} onChange={e=>setAccount(e.target.value)}><option value="512">Banque</option><option value="530">Espèces</option></select></label><label>Date<input type="date" min={summary.asOf} required value={date} onChange={e=>setDate(e.target.value)}/></label><button className="primary-button" disabled={!remaining.length}>Simuler le règlement</button>{notice&&<p role="status">{notice}</p>}</form>
    <div className="tv2-panel"><h3>Journal en partie double</h3><div className="danz-v2-scroll"><table><thead><tr><th>Date</th><th>Opération</th><th>Compte</th><th>Débit</th><th>Crédit</th></tr></thead><tbody>{workspace.entries.flatMap(e=>e.lines.map((l,i)=><tr key={e.id+':'+i}><td>{e.date}</td><td>{e.label}</td><td>{l.account}</td><td>{l.side==='D'?euro(l.cents):'—'}</td><td>{l.side==='C'?euro(l.cents):'—'}</td></tr>))}</tbody></table></div><p>Chaque opération est équilibrée et le total des créances et dettes est rapproché du journal.</p></div>
  </>}
 </section>
}
