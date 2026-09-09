import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'

export default function AdminRequests() {
  const { isAdmin, loading: authLoading } = useAuth()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const pendingCount = useMemo(() => requests.filter((request) => request.status === 'pending').length, [requests])

  const load = async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase
      .from('membership_requests')
      .select('id, auth_user_id, full_name, first_name, last_name, email, applicant_type, status, created_at')
      .order('created_at', { ascending: false })
    if (loadError) setError(loadError.message)
    setRequests(data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (isAdmin) load()
    else if (!authLoading) setLoading(false)
  }, [isAdmin, authLoading])

  if (!authLoading && !isAdmin) return <Navigate to="/" replace />

  const processRequest = async (id, action) => {
    if (action === 'reject' && !window.confirm('Refuser cette demande ? Le compte en attente sera supprimé et la personne pourra refaire une demande ultérieurement.')) return
    setBusyId(id)
    setError('')
    const { data, error: fnError } = await supabase.functions.invoke('approve-membership-request', { body: { requestId: id, action } })
    if (fnError || data?.error) setError(data?.error || fnError?.message || 'Impossible de traiter la demande.')
    else await load()
    setBusyId(null)
  }

  const tools = [
    ['/administration/systeme', '◉', 'État du système', 'Vérifier les services, volumes de données, sauvegardes et synchronisation hors ligne.'],
    ['/administration/utilisateurs', '🛡️', 'Utilisateurs & RGPD', 'Activer, suspendre ou supprimer un compte, définir le statut amicaliste et consulter le journal des accès.'],
    ['/administration/sauvegardes', '💾', 'Sauvegardes & exports', 'Télécharger une sauvegarde de reprise et des exports CSV de contrôle.'],
    ['/administration/contenus', '✍️', 'Publications', 'Créer, modifier ou supprimer une actualité ou un événement.'],
    ['/administration/galerie', '🖼️', 'Albums & téléchargements', 'Une miniature par événement et un lien WeTransfer pour les albums volumineux.'],
    ['/administration/bons-plans', '⭐', 'Bons plans', 'Valider les propositions, ajouter, corriger ou retirer une fiche.'],
    ['/administration/sondages', '✓', 'Sondages', 'Créer, clôturer ou supprimer les sondages.'],
    ['/administration/bureau', '👥', 'Bureau', 'Renseigner ou modifier les membres du bureau.'],
    ['/confidentialite', '📄', 'Politique de confidentialité', 'Relire la notice RGPD visible par les membres avant leur connexion.'],
  ]

  return <div className="admin-hub">
    <PageTitle eyebrow="Espace réservé" title="Administration" text="Toutes les créations, validations, modifications, sauvegardes et décisions d’accès du site sont regroupées ici afin de garder les pages membres propres, traçables et de limiter les fausses manipulations." />

    <section>
      <div className="admin-section-heading"><div><span className="eyebrow">Gestion du site</span><h2>Que voulez-vous administrer ?</h2></div></div>
      <div className="admin-hub-grid">
        {tools.map(([to, icon, title, text]) => <Link className="admin-hub-card" to={to} key={to}><span className="admin-hub-icon">{icon}</span><strong>{title}</strong><span>{text}</span></Link>)}
        <a className="admin-hub-card" href="#demandes-acces"><span className="admin-hub-icon">🔐</span><strong>Demandes d’accès</strong><span>Approuver ou refuser les nouveaux comptes.</span>{pendingCount > 0 && <span className="role-badge">{pendingCount} en attente</span>}</a>
      </div>
    </section>

    <section id="demandes-acces">
      <div className="admin-section-heading"><div><span className="eyebrow">Comptes membres</span><h2>Demandes d’accès</h2></div><span>{pendingCount ? `${pendingCount} demande${pendingCount > 1 ? 's' : ''} en attente` : 'Aucune demande en attente'}</span></div>
      <div className="privacy-note"><strong>Nouveau fonctionnement :</strong> la personne a déjà choisi son adresse e-mail et son mot de passe. Approuver cette demande active simplement son compte. Elle pourra ensuite se connecter immédiatement sans lien d’invitation ni nouvelle démarche. Le statut amicaliste se règle ensuite dans Utilisateurs & RGPD.</div>
      {error && <div className="alert error">{error}</div>}
      {loading ? <div className="skeleton-card" /> : requests.length === 0 ? <div className="empty-state">Aucune demande pour le moment.</div> : <div className="card-grid">
        {requests.map((request) => {
          const displayName = [request.first_name, request.last_name].filter(Boolean).join(' ') || request.full_name
          const situation = request.applicant_type === 'spouse' ? 'Conjoint(e)' : 'Militaire DANZ'
          return <article className="content-card" key={request.id}>
            <time>{new Date(request.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</time>
            <h3>{displayName}</h3>
            <p><strong>E-mail :</strong> {request.email}</p>
            <p><strong>Situation :</strong> {situation}</p>
            <p><strong>Statut amicaliste :</strong> à définir par un administrateur</p>
            <p><span className="role-badge">{request.status === 'pending' ? 'En attente' : request.status === 'approved' ? 'Approuvée' : 'Refusée'}</span></p>
            {request.status === 'pending' && <div style={{display:'flex',gap:'.75rem',flexWrap:'wrap'}}>
              <button className="primary-button" disabled={busyId === request.id} onClick={() => processRequest(request.id, 'approve')}>{busyId === request.id ? 'Traitement…' : 'Approuver et activer le compte'}</button>
              <button className="ghost-button" disabled={busyId === request.id} onClick={() => processRequest(request.id, 'reject')}>Refuser</button>
            </div>}
          </article>
        })}
      </div>}
    </section>
  </div>
}
