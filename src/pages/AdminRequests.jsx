import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'

export default function AdminRequests() {
  const { isAdmin, loading: authLoading } = useAuth()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase
      .from('membership_requests')
      .select('id, full_name, first_name, last_name, email, applicant_type, military_reference, message, status, created_at')
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

  const approve = async (id) => {
    setBusyId(id)
    setError('')
    const { data, error: fnError } = await supabase.functions.invoke('approve-membership-request', {
      body: { requestId: id },
    })
    if (fnError || data?.error) setError(data?.error || fnError?.message || 'Impossible d’approuver la demande.')
    else await load()
    setBusyId(null)
  }

  const reject = async (id) => {
    setBusyId(id)
    setError('')
    const { error: updateError } = await supabase
      .from('membership_requests')
      .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
      .eq('id', id)
    if (updateError) setError(updateError.message)
    else await load()
    setBusyId(null)
  }

  return <>
    <PageTitle eyebrow="Administration" title="Demandes d’accès" text="Validez ou refusez les nouvelles demandes d’inscription à l’espace amicaliste." />
    {error && <div className="alert error">{error}</div>}
    {loading ? <div className="skeleton-card" /> : requests.length === 0 ? (
      <div className="empty-state">Aucune demande pour le moment.</div>
    ) : (
      <div className="card-grid">
        {requests.map((request) => {
          const displayName = [request.first_name, request.last_name].filter(Boolean).join(' ') || request.full_name
          const typeLabel = request.applicant_type === 'spouse' ? 'Conjoint(e)' : 'Militaire'
          return <article className="content-card" key={request.id}>
            <time>{new Date(request.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</time>
            <h3>{displayName}</h3>
            <p><span className="role-badge">{typeLabel}</span></p>
            <p><strong>{request.email}</strong></p>
            {request.applicant_type === 'spouse' && request.military_reference && <p><strong>Militaire de rattachement :</strong> {request.military_reference}</p>}
            {request.message && <p>{request.message}</p>}
            <p><span className="role-badge">{request.status === 'pending' ? 'En attente' : request.status === 'approved' ? 'Approuvée' : 'Refusée'}</span></p>
            {request.status === 'pending' && <div style={{display:'flex',gap:'.75rem',flexWrap:'wrap'}}>
              <button className="primary-button" disabled={busyId === request.id} onClick={() => approve(request.id)}>{busyId === request.id ? 'Traitement…' : 'Approuver et inviter'}</button>
              <button className="ghost-button" disabled={busyId === request.id} onClick={() => reject(request.id)}>Refuser</button>
            </div>}
          </article>
        })}
      </div>
    )}
  </>
}
