import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import TreasuryDashboard from './TreasuryDashboard.jsx'
import LegacyTreasury from './LegacyTreasury.jsx'
import '../treasury-v2.css'

const TABS = [
  ['overview', 'Vue d’ensemble'],
  ['operations', 'Opérations'],
  ['memberships', 'Cotisations & dettes'],
  ['advanced', 'Gestion avancée'],
  ['settings', 'Mes comptes & export'],
]

export default function AdminTreasury() {
  const { isAdmin, isTreasurer, loading, refreshProfile } = useAuth()
  const [tab, setTab] = useState('overview')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (loading) return <div className="skeleton-card tall" />
  if (!isAdmin) return <Navigate to="/" replace />

  const claim = async () => {
    if (!window.confirm('Activer le rôle de trésorier sur votre compte administrateur ? Ce rôle est nominatif et réservé à un seul titulaire.')) return
    setBusy(true)
    setError('')
    try {
      const { error: roleError } = await supabase.rpc('claim_treasurer_role')
      if (roleError) throw roleError
      refreshProfile()
    } catch (err) {
      setError(err.message || 'Impossible d’activer le rôle trésorier.')
    } finally {
      setBusy(false)
    }
  }

  if (!isTreasurer) return <div className="treasury-v2 treasury-claim">
    <div className="tv2-hero">
      <span className="tv2-eyebrow">Accès réservé · Administration</span>
      <h1>Le bureau du trésorier</h1>
      <p>Un espace privé pour les dépenses, les cotisations et les deux caisses de l’Amicale : banque et espèces.</p>
    </div>
    <section className="tv2-panel">
      <span className="tv2-eyebrow">Compte administrateur</span>
      <h2>Activer mon rôle de trésorier</h2>
      <p>Vous conservez tous vos droits d’administrateur. Un seul compte peut devenir le titulaire de la trésorerie. Activez ce rôle uniquement si vous êtes le trésorier désigné.</p>
      {error && <div className="alert error" role="alert">{error}</div>}
      <button type="button" disabled={busy} className="primary-button" onClick={claim}>{busy ? 'Activation…' : 'Je suis le trésorier · Activer mon accès'}</button>
    </section>
  </div>

  return <div className="treasury-v2">
    <header className="tv2-page-title">
      <div><span className="tv2-eyebrow">Amicale DANZ · Accès nominatif</span><h1>Ma trésorerie</h1><p>Banque, espèces, cotisations et justificatifs au même endroit.</p></div>
      <span className="tv2-role">Administrateur + Trésorier</span>
    </header>
    <nav className="tv2-tabs" aria-label="Sections de la trésorerie">
      {TABS.map(([key, label]) => <button type="button" key={key} className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>)}
    </nav>
    {tab === 'advanced' ? <div className="tv2-legacy"><LegacyTreasury /></div> : <TreasuryDashboard view={tab} onAdvanced={() => setTab('advanced')} onView={setTab} />}
  </div>
}
