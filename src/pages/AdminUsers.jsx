import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../admin-users.css'

const applicantLabels = { military: 'Militaire DANZ', spouse: 'Conjoint(e)' }
const auditLabels = {
  user_access_updated: 'Compte / statut modifié',
  user_suspended: 'Compte suspendu',
  user_deleted: 'Compte et données personnelles supprimés',
  membership_approved: 'Demande d’accès approuvée',
  membership_rejected: 'Demande d’accès refusée',
  data_exported: 'Sauvegarde / export des données',
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
    amicalistes: profiles.filter((profile) => profile.is_amicaliste === true).length,
  }), [profiles])

  const nameById = useMemo(() => Object.fromEntries(profiles.map((profile) => [profile.id, profile.full_name || profile.email || 'Utilisateur'])), [profiles])
  const auditTargetLabel = (entry) => {
    if (entry.action === 'data_exported') return 'Données du site'
    if (entry.target_user_id) return nameById[entry.target_user_id] || 'Utilisateur'
    if (entry.action.startsWith('membership_')) return 'Demande d’accès'
    return 'Compte supprimé'
  }

  const valuesFor = (profile) => ({
    role: profile.role === 'admin' ? 'admin' : 'member',
    applicant_type: profile.applicant_type || '',
    is_amicaliste: profile.is_amicaliste === true ? 'yes' : 'no',
  })

  const beginEdit = (profile) => {
    setEditingId(profile.id)
    setDraft(valuesFor(profile))
    setError('')
    setSuccess('')
  }

  const applyAccess = async (profile, active = profile.active, values = draft) => {
    setBusyId(profile.id)
    setError('')
    setSuccess('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('admin-user-management', {
        body: {
          action: 'set-access',
          userId: profile.id,
          active,
          role: values?.role || profile.role,
          applicantType: values?.applicant_type || null,
          isAmicaliste: values?.is_amicaliste === 'yes',
        },
      })
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'Impossible de modifier ce compte.')
      setEditingId(null)
      setDraft(null)
      setSuccess(active ? 'Le compte et le statut de l’utilisateur ont été enregistrés.' : 'Le compte a été suspendu. Ses identifiants restent enregistrés mais l’accès au site est bloqué.')
      await load()
    } catch (err) {
      setError(err.message || 'Impossible de modifier ce compte.')
    } finally {
      setBusyId(null)
    }
  }

  const suspend = async (profile) => {
    if (!window.confirm(`Suspendre l’accès de ${profile.full_name || profile.email} ? Ses identifiants resteront enregistrés, mais il ne pourra plus ouvrir le site.`)) return
    await applyAccess(profile, false, valuesFor(profile))
  }

  const reactivate = async (profile) => applyAccess(profile, true, valuesFor(profile))

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
    <PageTitle eyebrow="Administration · RGPD" title="Utilisateurs & accès" text="Un compte approuvé se connecte avec son e-mail et son mot de passe. Ici vous gérez séparément l’activation du compte, le rôle administrateur, la situation et le statut amicaliste." />

    <div className="admin-user-stats">
      <article><strong>{counts.total}</strong><span>compte{counts.total > 1 ? 's' : ''} enregistré{counts.total > 1 ? 's' : ''}</span></article>
      <article><strong>{counts.active}</strong><span>accès actif{counts.active > 1 ? 's' : ''}</span></article>
      <article><strong>{counts.suspended}</strong><span>compte{counts.suspended > 1 ? 's' : ''} suspendu{counts.suspended > 1 ? 's' : ''}</span></article>
      <article><strong>{counts.amicalistes}</strong><span>amicaliste{counts.amicalistes > 1 ? 's' : ''}</span></article>
    </div>

    <div className="privacy-note admin-rgpd-note"><strong>Principe</strong><br />« Actif / suspendu » détermine uniquement si la personne peut se connecter. « Administrateur / membre » détermine ses droits de gestion. « Amicaliste / non-amicaliste » est un statut indépendant, modifiable à tout moment sans changer ses identifiants.</div>

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
                  <span className={`role-badge ${profile.active ? '' : 'muted'}`}>{profile.active ? 'Accès actif' : 'Accès suspendu'}</span>
                  <span className="role-badge">{profile.role === 'admin' ? 'Administrateur' : 'Membre'}</span>
                  {profile.applicant_type && <span>{applicantLabels[profile.applicant_type] || profile.applicant_type}</span>}
                  <span>{profile.is_amicaliste === true ? 'Amicaliste' : 'Non-amicaliste'}</span>
                </div>
                <small>Compte créé le {new Date(profile.created_at).toLocaleDateString('fr-FR')}{profile.deactivated_at ? ` · suspendu le ${new Date(profile.deactivated_at).toLocaleDateString('fr-FR')}` : ''}</small>
              </div>
            </div>

            {!editing && <div className="admin-user-actions">
              <button type="button" className="ghost-button" onClick={() => beginEdit(profile)} disabled={busyId === profile.id}>Modifier le compte</button>
              {profile.active ? <button type="button" className="ghost-button" onClick={() => suspend(profile)} disabled={self || busyId === profile.id}>Suspendre</button> : <button type="button" className="secondary-button" onClick={() => reactivate(profile)} disabled={busyId === profile.id}>Réactiver</button>}
              <button type="button" className="ghost-button danger-action" onClick={() => deleteUser(profile)} disabled={self || busyId === profile.id}>Supprimer les données</button>
            </div>}

            {editing && draft && <form className="admin-user-edit" onSubmit={(event) => { event.preventDefault(); applyAccess(profile, profile.active, draft) }}>
              <label>Rôle du compte<select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}><option value="member">Membre</option><option value="admin">Administrateur</option></select></label>
              <label>Situation<select value={draft.applicant_type} onChange={(event) => setDraft({ ...draft, applicant_type: event.target.value })}><option value="">Non renseignée</option><option value="military">Militaire DANZ</option><option value="spouse">Conjoint(e)</option></select></label>
              <label>Statut amicaliste<select value={draft.is_amicaliste} onChange={(event) => setDraft({ ...draft, is_amicaliste: event.target.value })}><option value="yes">Amicaliste</option><option value="no">Non-amicaliste</option></select></label>
              <div className="admin-user-edit-actions"><button className="primary-button" disabled={busyId === profile.id}>{busyId === profile.id ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" className="ghost-button" onClick={() => { setEditingId(null); setDraft(null) }}>Annuler</button></div>
            </form>}
          </article>
        })}
      </div>}
    </section>

    <section>
      <div className="admin-section-heading"><div><span className="eyebrow">Traçabilité</span><h2>Journal d’administration</h2></div><span>40 dernières actions</span></div>
      {audit.length === 0 ? <div className="empty-state">Aucune modification d’accès enregistrée pour le moment.</div> : <div className="admin-audit-list">
        {audit.map((entry) => <article key={entry.id}><div><strong>{auditLabels[entry.action] || entry.action}</strong><span>{auditTargetLabel(entry)}</span></div><small>{new Date(entry.created_at).toLocaleString('fr-FR')} · par {entry.actor_id ? nameById[entry.actor_id] || 'Administrateur' : 'ancien administrateur'}</small></article>)}
      </div>}
    </section>
  </div>
}
