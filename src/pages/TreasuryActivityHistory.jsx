import { useMemo, useState } from 'react'
import { formatMoney } from '../lib/finance.js'
import '../treasury-history.css'

const labels = {
  treasury_entry_edited:'Correction d’écriture',treasury_entry_cancelled:'Écriture annulée',
  treasury_entry_restored:'Écriture restaurée',treasury_excel_batch_import:'Import Excel validé',
  offline_people_merged:'Fusion de deux personnes',offline_person_linked:'Compte et fiche réunis',
  households_merged:'Fusion de foyers',treasury_entry_created:'Nouvelle opération',
  ledger_treasury_entries_insert:'Nouvelle recette ou dépense',ledger_treasury_entries_update:'Opération modifiée',
  ledger_treasury_entries_delete:'Opération supprimée',ledger_treasury_transfers_insert:'Transfert créé',
  ledger_treasury_transfers_update:'Transfert modifié',ledger_treasury_opening_insert:'Solde initial',
  ledger_treasury_opening_update:'Soldes rapprochés',ledger_household_charges_insert:'Dette créée',
  ledger_household_charges_update:'Dette modifiée',ledger_household_payments_insert:'Paiement enregistré',
  ledger_household_payments_update:'Paiement confirmé / corrigé',
  ledger_treasury_event_participants_insert:'Participant ajouté',
  ledger_treasury_event_participants_update:'Participant modifié',
  ledger_membership_subscriptions_insert:'Cotisation enregistrée',
  ledger_membership_subscriptions_update:'Cotisation modifiée',
  ledger_offline_people_insert:'Personne créée',
  ledger_offline_people_update:'Fiche modifiée',
}
const dateText = (value) => value ? new Date(value).toLocaleString('fr-FR') : '—'
const actionText = (action) => labels[action] || String(action).replaceAll('_',' ')
const detailsText = (a) => {
  const d=a.details || {}
  if(d.label && d.entry_id) return d.label
  if(d.source_name && d.target_name) return d.source_name + ' → ' + d.target_name
  if(d.count !== undefined) return d.count + ' écriture(s) mises à jour'
  if(d.entry_id || d.transfer_id || d.record_id || d.source_id) return 'Référence ' + String(d.entry_id||d.transfer_id||d.record_id||d.source_id).slice(0,8)
  return ''
}
export default function TreasuryActivityHistory({data}) {
  const [query,setQuery]=useState('')
  const [type,setType]=useState('all')
  const [limit,setLimit]=useState(80)
  const people=useMemo(()=>Object.fromEntries((data.profiles || []).map(p=>[p.id,p.full_name||p.email||'Administrateur'])),[data.profiles])
  const rows=useMemo(()=>{
    const fromAudit=(data.audit || []).map(a=>({
      key:'a'+a.id,date:a.created_at,type:'action',label:actionText(a.action),
      note:detailsText(a),actor:people[a.actor_id]||'Système / ancien historique',
      haystack:JSON.stringify(a.details||{})+' '+a.action,
    }))
    const fromEntries=(data.entries || []).map(e=>({
      key:'e'+e.id,date:e.created_at||e.occurred_at,type:'operation',
      label:e.kind==='income'?'Recette : '+e.label:'Dépense : '+e.label,
      note:formatMoney(e.amount_cents)+' · '+(e.status==='cancelled'?'Annulée':e.payment_method==='personal_advance'&&e.status==='pending'?'Avance à rembourser':'Enregistrée'),
      actor:people[e.created_by]||'Import / saisie antérieure',haystack:e.label+' '+(e.note||''),
    }))
    const fromTransfers=(data.transfers || []).map(t=>({
      key:'t'+t.id,date:t.created_at||t.occurred_at,type:'operation',label:'Transfert Revolut / espèces',
      note:formatMoney(t.amount_cents)+(t.cancelled_at?' · annulé':''),actor:people[t.created_by]||'Système',
      haystack:t.note||'',
    }))
    return [...fromAudit,...fromEntries,...fromTransfers].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))
  },[data,people])
  const filtered=rows.filter(r=>(type==='all'||r.type===type)&&
    (r.label+' '+r.note+' '+r.actor+' '+r.haystack).toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')))
  return <section className="tah">
    <div className="tah-head"><div><span className="tv2-eyebrow">Journal de traçabilité</span><h2>Historique des actions et mouvements</h2><p>Opérations financières, corrections, imports, fusions et actions enregistrées, triés par date.</p></div><strong>{filtered.length} actions / écritures</strong></div>
    <div className="tah-filter"><input type="search" value={query} onChange={e=>{setQuery(e.target.value);setLimit(80)}} placeholder="Rechercher un mouvement, un auteur ou une action…" aria-label="Rechercher dans l’historique"/>
      <select value={type} onChange={e=>{setType(e.target.value);setLimit(80)}} aria-label="Type d’historique"><option value="all">Toutes les actions</option><option value="operation">Opérations et transferts</option><option value="action">Modifications et actions tracées</option></select></div>
    <div className="tah-list">{filtered.slice(0,limit).map(r=><article key={r.key} className="tah-row">
      <span className={r.type==='action'?'tah-icon audit':'tah-icon'}>{r.type==='action'?'↻':'€'}</span>
      <div><strong>{r.label}</strong><small>{r.note}</small><small>{r.actor}</small></div>
      <time>{dateText(r.date)}</time>
    </article>)}
    {!filtered.length&&<p className="tv2-empty">Aucune action ne correspond à la recherche.</p>}
    </div>
    {filtered.length>limit&&<button type="button" className="ghost-button" onClick={()=>setLimit(n=>n+80)}>Afficher les 80 suivantes</button>}
    <p className="tah-foot">Les écritures antérieures restent visibles. Le détail systématique des modifications est enregistré à partir de la mise en place du suivi renforcé ; les corrections déjà auditées restent conservées.</p>
  </section>
}
