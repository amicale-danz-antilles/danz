import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../admin-users.css'

const accessLabels = {
  admin: 'Administrateur',
  personnel_danz: 'Personnel DANZ',
  amicaliste: 'Amicaliste',
}
const applicantLabels = { military: 'Militaire DANZ', spouse: 'Conjoint(e)' }
const auditLabels = {
  user_access_updated: 'Accès modifié / compte réactivé',
  user_suspended: 'Compte suspendu',
  user_deleted: 'Compte et données personnelles supprimés',
  membership_approved: 'Demande d’accès approuvée',
  membership_rejected: 'Demande d’accès refusée',
}

export default function AdminUsers() {
  const { user, isAdmin, loading: authLoading } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [audit, setAudit] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(null)

  const load = async () => {
    setLoading(true)
    setError('')
    const [profilesResult, auditResult] = await Promise.all([
      supabase.from('profiles').select('id,full_name,email,role,active,access_type,applicant_type,is_amicaliste,created_at,updated_at,deactivated_at').order('created_at', { ascending: true }),
      supabase.from('admin_audit_log').select('id,actor_id,action,target_user_id,created_at').order('created_at', { ascending: false }).limit(40),
    ])
    if (profilesResult.error) setError(profilesResult.error.message)
    if (auditResult.error) setError(auditResult.error.message)
    setProfiles(profilesResult.data || [])
    setAudit(auditResult.data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (isAdmin) load()
    else if (!authLoading) setLoading(false)
  }, [isAdmin, authLoading])

  if (!authLoading && !isAdmin) return <Navigate to="/" replace />

  const counts = useMemo(() => ({
    total: profiles.length,
    active: profiles.filter((profile) => profile.active).length,
    suspended: profiles.filter((profile) => !profile.active).length,
    admins: profiles.filter((profile) => profile.active && profile.role === 'admin').length,
  }), [profiles])

  const nameById = useMemo(() => Object.fromEntries(profiles.map((profile) => [profile.id, profile.full_name || profile.email || 'Utilisateur'])), [profiles])

  const beginEdit = (profile) => {
    setEditingId(profile.id)
    setDraft({
      access_type: profile.access_type || 'amicaliste',
      applicant_type: profile.applicant_type || '',
      is_amicaliste: profile.is_amicaliste === true ? 'yes' : profile.is_amicaliste === false ? 'no' : 'unknown',
    })
    setError('')
    setSuccess('')
  }

  const applyAccess = async (profile, active = profile.active, values = draft) => {
    setBusyId(profile.id)
    setError('')
    setSuccess('')
    try {
      const isAmicaliste = values?.is_amicaliste === 'unknown' ? null : values?.is_amicaliste === 'yes'
      const { data, error: fnError } = await supabase.functions.invoke('admin-user-management', {
        body: {
          action: 'set-access',
          userId: profile.id,
          active,
          accessType: values?.access_type || profile.access_type,
          applicantType: values?.applicant_type || null,
          isAmicaliste,
        },
      })
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'Impossible de modifier ce compte.')
      setEditingId(null)
      setDraft(null)
      setSuccess(active ? 'Les droits de l’utilisateur ont été enregistrés.' : 'Le compte a été suspendu. Les règles d’accès bloquent désormais ses données privées.')
      await load()
    } catch (err) {
      setError(err.message || 'Impossible de modifier ce compte.')
    } finally {
      setBusyId(null)
    }
  }

  const suspend = async (profile) => {
    if (!window.confirm(`Suspendre l’accès de ${profile.full_name || profile.email} ?`)) return
    await applyAccess(profile, false, {
      access_type: profile.access_type,
      applicant_type: profile.applicant_type || '',
      is_amicaliste: profile.is_amicaliste === true ? 'yes' : profile.is_amicaliste === false ? 'no' : 'unknown',
    })
  }

  const reactivate = async (profile) => {
    await applyAccess(profile, true, {
      access_type: profile.access_type,
      applicant_type: profile.applicant_type || '',
      is_amicaliste: profile.is_amicaliste === true ? 'yes' : profile.is_amicaliste === false ? 'no' : 'unknown',
    })
  }

  const deleteUser = async (profile) => {
    const answer = window.prompt(`Suppression RGPD définitive de ${profile.full_name || profile.email}.\n\nCette action supprime le compte, ses votes, préférences et abonnements push. Le contenu collectif déjà publié est conservé mais anonymisé.\n\nTapez SUPPRIMER pour confirmer.`)
    if (answer !== 'SUPPRIMER') return
    setBusyId(profile.id)
    setError('')
    setSuccess('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('admin-user-management', { body: { action: 'delete', userId: profile.id } })
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'Suppression impossible.')
      setSuccess('Le compte et les données personnelles directement rattachées ont été supprimés.')
      await load()
    } catch (err) {
      setError(err.message || 'Suppression impossible.')
    } finally {
      setBusyId(null)
    }
  }

  return <div className="admin-users-page">
    <PageTitle eyebrow="Administration · RGPD" title="Utilisateurs & accès" text="Contrôlez qui peut entrer sur le site, suspendez immédiatement un accès, modifiez les droits et conservez une trace des décisions administratives." />

    <div className="admin-user-stats">
      <article><strong>{counts.total}</strong><span>compte{counts.total > 1 ? 's' : ''} enregistré{counts.total > 1 ? 's' : ''}</span></article>
      <article><strong>{counts.active}</strong><span>accès actif{counts.active > 1 ? 's' : ''}</span></article>
      <article><strong>{counts.suspended}</strong><span>compte{counts.suspended > 1 ? 's' : ''} suspendu{counts.suspended > 1 ? 's' : ''}</span></article>
      <article><strong>{counts.admins}</strong><span>administrateur{counts.admins > 1 ? 's' : ''} actif{counts.admins > 1 ? 's' : ''}</span></article>
    </div>

    <div className="privacy-note admin-rgpd-note"><strong>Principe de maîtrise des accès</strong><br />Un compte suspendu reste identifiable dans le registre administratif mais ne peut plus accéder aux données membres. Une suppression RGPD retire son compte et ses données directement liées. Les publications collectives restent disponibles sans identifiant d’auteur.</div>

    {error && <div className="alert error">{error}</div>}
    {success && <div className="alert">{success}</div>}

    <section>
      <div className="admin-section-heading"><div><span className="eyebrow">Base utilisateurs</span><h2>Comptes enregistrés</h2></div><span>{counts.active} actif{counts.active > 1 ? 's' : ''}</span></div>
      {loading ? <div className="skeleton-card" /> : profiles.length === 0 ? <div className="empty-state">Aucun compte.</div> : <div className="admin-user-list">
        {profiles.map((profile) => {
          const self = profile.id === user?.id
          const editing = editingId === profile.id
          return <article className={`admin-user-card ${profile.active ? '' : 'is-suspended'}`} key={profile.id}>
            <div className="admin-user-main">
              <div className="admin-user-avatar">{(profile.full_name || profile.email || '?')[0].toUpperCase()}</div>
              <div className="admin-user-identity">
                <div className="admin-user-title"><h3>{profile.full_name || 'Nom non renseigné'}</h3>{self && <span className="role-badge">Votre compte</span>}</div>
                <p>{profile.email}</p>
                <div className="admin-user-badges">
                  <span className={`role-badge ${profile.active ? '' : 'muted'}`}>{profile.active ? 'Actif' : 'Suspendu'}</span>
                  <span className="role-badge">{accessLabels[profile.access_type] || profile.access_type}</span>
                  {profile.applicant_type && <span>{applicantLabels[profile.applicant_type] || profile.applicant_type}</span>}
                  {profile.is_amicaliste === true && <span>Amicaliste</span>}
                </div>
                <small>Compte créé le {new Date(profile.created_at).toLocaleDateString('fr-FR')}{profile.deactivated_at ? ` · suspendu le ${new Date(profile.deactivated_at).toLocaleDateString('fr-FR')}` : ''}</small>
              </div>
            </div>

            {!editing && <div className="admin-user-actions">
              <button type="button" className="ghost-button" onClick={() => beginEdit(profile)} disabled={busyId === profile.id}>Modifier les droits</button>
              {profile.active ? <button type="button" className="ghost-button" onClick={() => suspend(profile)} disabled={self || busyId === profile.id}>Suspendre</button> : <button type="button" className="secondary-button" onClick={() => reactivate(profile)} disabled={busyId === profile.id}>Réactiver</button>}
              <button type="button" className="ghost-button danger-action" onClick={() => deleteUser(profile)} disabled={self || busyId === profile.id}>Supprimer les données</button>
            </div>}

            {editing && draft && <form className="admin-user-edit" onSubmit={(event) => { event.preventDefault(); applyAccess(profile, profile.active, draft) }}>
              <label>Niveau d’accès<select value={draft.access_type} onChange={(event) => setDraft({ ...draft, access_type: event.target.value })}><option value="personnel_danz">Personnel DANZ</option><option value="amicaliste">Amicaliste</option><option value="admin">Administrateur</option></select></label>
              <label>Situation<select value={draft.applicant_type} onChange={(event) => setDraft({ ...draft, applicant_type: event.target.value })}><option value="">Non renseignée</option><option value="military">Militaire DANZ</option><option value="spouse">Conjoint(e)</option></select></label>
              <label>Statut amicaliste<select value={draft.is_amicaliste} onChange={(event) => setDraft({ ...draft, is_amicaliste: event.target.value })}><option value="unknown">Non renseigné</option><option value="yes">Oui</option><option value="no">Non</option></select></label>
              <div className="admin-user-edit-actions"><button className="primary-button" disabled={busyId === profile.id}>{busyId === profile.id ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" className="ghost-button" onClick={() => { setEditingId(null); setDraft(null) }}>Annuler</button></div>
            </form>}
          </article>
        })}
      </div>}
    </section>

    <section>
      <div className="admin-section-heading"><div><span className="eyebrow">Traçabilité</span><h2>Journal d’administration</h2></div><span>40 dernières actions</span></div>
      {audit.length === 0 ? <div className="empty-state">Aucune modification d’accès enregistrée pour le moment.</div> : <div className="admin-audit-list">
        {audit.map((entry) => <article key={entry.id}><div><strong>{auditLabels[entry.action] || entry.action}</strong><span>{entry.target_user_id ? nameById[entry.target_user_id] || 'Utilisateur' : entry.action.startsWith('membership_') ? 'Demande d’accès' : 'Compte supprimé'}</span></div><small>{new Date(entry.created_at).toLocaleString('fr-FR')} · par {entry.actor_id ? nameById[entry.actor_id] || 'Administrateur' : 'ancien administrateur'}</small></article>)}
      </div>}
    </section>
  </div>
}
