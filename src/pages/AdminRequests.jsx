import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import '../admin-central.css'

const mainLinks = [
  ['/administration/utilisateurs', '👥', 'Membres & accès', 'Demandes en attente, comptes actifs et personnes sans compte.'],
  ['/administration/tresorerie', '€', 'Trésorerie', 'Compte bancaire, caisse, dettes, cotisations et remboursements.'],
  ['/administration/contenus', '✎', 'Publications & événements', 'Actualités, agenda, photos et albums.'],
]
const associationLinks = [
  ['/administration/bons-plans', 'Bons plans', 'Offres et validation'],
  ['/administration/sondages', 'Sondages', 'Recensements et participations'],
  ['/administration/bureau', 'Bureau', 'Organisation et contacts'],
]
const toolLinks = [
  ['/administration/sauvegardes', 'Sauvegardes du site'],
  ['/administration/systeme', 'État du système'],
  ['/notifications', 'Notifications'],
]

export default function AdminRequests() {
  const { isAdmin, loading: authLoading } = useAuth()
  const [counts, setCounts] = useState({ pending: 0, active: 0, offline: 0 })
  useEffect(() => {
    if (!isAdmin) return
    let active = true
    Promise.all([
      supabase.from('membership_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('offline_people').select('id', { count: 'exact', head: true }).is('linked_user_id', null),
    ]).then(([pending, profiles, offline]) => {
      if (active) setCounts({ pending: pending.count || 0, active: profiles.count || 0, offline: offline.count || 0 })
    }).catch(() => {})
    return () => { active = false }
  }, [isAdmin])
  if (authLoading) return <div className="skeleton-card tall" />
  if (!isAdmin) return <Navigate to="/" replace />

  return <div className="admin-home-v3">
    <header className="admin-home-heading"><div><span className="eyebrow">Espace administrateur</span><h1>Administration</h1><p>Trois espaces essentiels, les autres outils rangés par usage.</p></div><Link className="admin-home-pending" to="/administration/utilisateurs"><strong>{counts.pending}</strong><span>demande{counts.pending > 1 ? 's' : ''}<br/>à traiter →</span></Link></header>
    <div className="admin-home-main">{mainLinks.map(([to, icon, title, desc], index) => <Link className="admin-home-primary" to={to} key={to}><span className="admin-home-primary-icon">{icon}</span><div><h2>{title}</h2><p>{desc}</p>{index === 0 && <small>{counts.active} compte{counts.active > 1 ? 's' : ''} actif{counts.active > 1 ? 's' : ''} · {counts.offline} sans compte · {counts.pending} en attente</small>}</div><span className="admin-home-arrow">↗</span></Link>)}</div>
    <section className="admin-home-extras"><h2>Vie associative</h2><div className="admin-home-compact-links">{associationLinks.map(([to, label, desc]) => <Link key={to} to={to}><strong>{label}</strong><span>{desc}</span><b>›</b></Link>)}</div></section>
    <details className="admin-home-advanced"><summary>Outils techniques et réglages</summary><div>{toolLinks.map(([to, label]) => <Link key={to} to={to}>{label} <span>↗</span></Link>)}<Link to="/confidentialite">Confidentialité <span>↗</span></Link></div></details>
  </div>
}
