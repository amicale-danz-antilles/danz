import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../admin-users.css'

const auditLabels = {
  user_access_updated: 'Compte / statut modifié',
  user_suspended: 'Compte suspendu',
  user_deleted: 'Compte et données personnelles supprimés',
  user_password_reset_by_admin: 'Mot de passe remplacé par un administrateur',
  membership_approved: 'Demande d’accès approuvée',
  membership_rejected: 'Demande d’accès refusée',
  data_exported: 'Sauvegarde / export des données',
}

const valuesFor = (profile) => ({
  active: profile.active === true,
  role: profile.role === 'admin' ? 'admin' : 'member',
  applicant_type: profile.applicant_type || '',
  is_amicaliste: profile.is_amicaliste === true ? 'yes' : 'no',
})

const sameValues = (left, right) => Boolean(left && right)
  && left.active === right.active
  && left.role === right.role
  && left.applicant_type === right.applicant_type
  && left.is_amicaliste === right.is_amicaliste

export default function AdminUsers() {
  const { user, isAdmin, loading: authLoading } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [drafts, setDrafts] = useState({})
  const [audit, setAudit] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [query, setQuery] = useState('')
  const [passwordTarget, setPasswordTarget] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const load = async ({ preserveDirty = false, exceptId = null } = {}) => {
    const previousProfiles = profiles
    const previousDrafts = drafts
    const dirtyIds = preserveDirty
      ? new Set(previousProfiles.filter((profile) => !sameValues(previousDrafts[profile.id], valuesFor(profile))).map((profile) => profile.id))
      : new Set()

    setLoading(true)
    setError('')
    const [profilesResult, auditResult] = await Promise.all([
      supabase.from('profiles').select('id,full_name,email,role,active,access_type,applicant_type,is_amicaliste,created_at,updated_at,deactivated_at').order('full_name', { ascending: true }),
      supabase.from('admin_audit_log').select('id,actor_id,action,target_user_id,created_at').order('created_at', { ascending: false }).limit(50),
    ])
    if (profilesResult.error) setError(profilesResult.error.message)
    if (auditResult.error) setError((current) => current || auditResult.error.message)
    const rows = profilesResult.data || []
    setProfiles(rows)
    setDrafts(Object.fromEntries(rows.map((profile) => {
      const keepDraft = preserveDirty && profile.id !== exceptId && dirtyIds.has(profile.id) && previousDrafts[profile.id]
      return [profile.id, keepDraft ? previousDrafts[profile.id] : valuesFor(profile)]
    })))
    setAudit(auditResult.data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (isAdmin) load()
    else if (!authLoading) setLoading(false)
  }, [isAdmin, authLoading])

  useEffect(() => {
    if (!passwordTarget) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && busyId !== passwordTarget.id) setPasswordTarget(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [passwordTarget, busyId])

  if (!authLoading && !isAdmin) return <Navigate to="/" replace />

  const counts = useMemo(() => ({
    total: profiles.length,
    active: profiles.filter((profile) => profile.active).length,
    admins: profiles.filter((profile) => profile.active && profile.role === 'admin').length,
    amicalistes: profiles.filter((profile) => profile.is_amicaliste === true).length,
  }), [profiles])

  const filteredProfiles = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return profiles
    return profiles.filter((profile) => `${profile.full_name || ''} ${profile.email || ''}`.toLowerCase().includes(needle))
  }, [profiles, query])

  const dirtyCount = useMemo(() => profiles.reduce((count, profile) => count + (!sameValues(drafts[profile.id], valuesFor(profile)) ? 1 : 0), 0), [profiles, drafts])
  const nameById = useMemo(() => Object.fromEntries(profiles.map((profile) => [profile.id, profile.full_name || profile.email || 'Utilisateur'])), [profiles])

  const updateDraft = (id, key, value) => setDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }))
  const isDirty = (profile) => !sameValues(drafts[profile.id], valuesFor(profile))
  const resetRow = (profile) => setDrafts((current) => ({ ...current, [profile.id]: valuesFor(profile) }))

  const saveRow = async (profile) => {
    const draft = drafts[profile.id]
    if (!draft || !isDirty(profile)) return
    setBusyId(profile.id)
    setError('')
    setSuccess('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('admin-user-management', {
        body: {
          action: 'set-access',
          userId: profile.id,
          active: draft.active,
          role: draft.role,
          applicantType: draft.applicant_type || null,
          isAmicaliste: draft.is_amicaliste === 'yes',
        },
      })
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'Impossible de modifier ce compte.')
      setSuccess(`Compte de ${profile.full_name || profile.email} mis à jour.`)
      await load({ preserveDirty: true, exceptId: profile.id })
    } catch (err) {
      setError(err.message || 'Impossible de modifier ce compte.')
    } finally {
      setBusyId(null)
    }
  }

  const openPasswordReset = (profile) => {
    setPasswordTarget(profile)
    setNewPassword('')
    setConfirmPassword('')
    setError('')
    setSuccess('')
  }

  const replacePassword = async (event) => {
    event.preventDefault()
    if (!passwordTarget) return
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) return setError('Le mot de passe doit contenir au moins 10 caractères, avec au moins une lettre et un chiffre.')
    if (newPassword !== confirmPassword) return setError('Les deux mots de passe ne correspondent pas.')
    setBusyId(passwordTarget.id)
    setError('')
    setSuccess('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('admin-user-management', { body: { action: 'set-password', userId: passwordTarget.id, password: newPassword } })
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'Impossible de remplacer le mot de passe.')
      const label = passwordTarget.full_name || passwordTarget.email
      setPasswordTarget(null)
      setNewPassword('')
      setConfirmPassword('')
      setSuccess(`Nouveau mot de passe enregistré pour ${label}. L’ancien mot de passe n’est plus valable pour les prochaines connexions.`)
      await load({ preserveDirty: true })
    } catch (err) {
      setError(err.message || 'Impossible de remplacer le mot de passe.')
    } finally {
      setBusyId(null)
    }
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
      await load({ preserveDirty: true, exceptId: profile.id })
    } catch (err) {
      setError(err.message || 'Suppression impossible.')
    } finally {
      setBusyId(null)
    }
  }

  const auditTargetLabel = (entry) => {
    if (entry.action === 'data_exported') return 'Données du site'
    if (entry.target_user_id) return nameById[entry.target_user_id] || 'Utilisateur'
    if (entry.action.startsWith('membership_')) return 'Demande d’accès'
    return 'Compte supprimé'
  }

  return <div className="admin-users-page">
    <PageTitle eyebrow="Administration · RGPD" title="Utilisateurs & droits" text="Tous les comptes sont regroupés dans un tableau éditable. Modifiez l’accès, le rôle administrateur, le statut amicaliste ou la situation puis enregistrez la ligne concernée." />

    <div className="admin-user-stats">
      <article><strong>{counts.total}</strong><span>comptes enregistrés</span></article>
      <article><strong>{counts.active}</strong><span>accès actifs</span></article>
      <article><strong>{counts.admins}</strong><span>administrateurs actifs</span></article>
      <article><strong>{counts.amicalistes}</strong><span>amicalistes</span></article>
    </div>

    <div className="privacy-note admin-rgpd-note"><strong>Gestion des mots de passe</strong><br />Un administrateur ne peut jamais consulter le mot de passe actuel. Le bouton « Nouveau mot de passe » le remplace directement dans le service d’authentification et l’opération est journalisée sans enregistrer la valeur saisie.</div>

    {dirtyCount > 0 && <div className="admin-unsaved-note" role="status">{dirtyCount} ligne{dirtyCount > 1 ? 's' : ''} modifiée{dirtyCount > 1 ? 's' : ''} mais non enregistrée{dirtyCount > 1 ? 's' : ''}. Enregistrez chaque ligne concernée.</div>}
    {error && <div className="alert error">{error}</div>}
    {success && <div className="alert">{success}</div>}

    <section>
      <div className="admin-section-heading"><div><span className="eyebrow">Base utilisateurs</span><h2>Tableau des comptes</h2></div><span>{filteredProfiles.length} affiché{filteredProfiles.length > 1 ? 's' : ''}</span></div>
      <div className="admin-user-toolbar"><input type="search" placeholder="Rechercher un nom ou une adresse e-mail…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>

      {loading ? <div className="skeleton-card" /> : profiles.length === 0 ? <div className="empty-state">Aucun compte.</div> : filteredProfiles.length === 0 ? <div className="empty-state">Aucun utilisateur ne correspond à cette recherche.</div> : <div className="admin-user-table-wrap">
        <table className="admin-user-table">
          <thead><tr><th>Utilisateur</th><th>Accès</th><th>Rôle</th><th>Amicaliste</th><th>Situation</th><th>Mot de passe</th><th>Actions</th></tr></thead>
          <tbody>{filteredProfiles.map((profile) => {
            const self = profile.id === user?.id
            const draft = drafts[profile.id] || valuesFor(profile)
            const busy = busyId === profile.id
            const dirty = isDirty(profile)
            return <tr key={profile.id} className={profile.active ? '' : 'is-suspended'}>
              <td data-label="Utilisateur"><div className="admin-table-user"><span className="admin-user-avatar">{(profile.full_name || profile.email || '?')[0].toUpperCase()}</span><div><strong>{profile.full_name || 'Nom non renseigné'}</strong><small>{profile.email}</small>{self && <em>Votre compte</em>}</div></div></td>
              <td data-label="Accès"><select value={draft.active ? 'active' : 'suspended'} disabled={busy || self} onChange={(event) => updateDraft(profile.id, 'active', event.target.value === 'active')}><option value="active">Actif</option><option value="suspended">Suspendu</option></select></td>
              <td data-label="Rôle"><select value={draft.role} disabled={busy || self} onChange={(event) => updateDraft(profile.id, 'role', event.target.value)}><option value="member">Membre</option><option value="admin">Administrateur</option></select></td>
              <td data-label="Amicaliste"><select value={draft.is_amicaliste} disabled={busy} onChange={(event) => updateDraft(profile.id, 'is_amicaliste', event.target.value)}><option value="yes">Amicaliste</option><option value="no">Non-amicaliste</option></select></td>
              <td data-label="Situation"><select value={draft.applicant_type} disabled={busy} onChange={(event) => updateDraft(profile.id, 'applicant_type', event.target.value)}><option value="">Non renseignée</option><option value="military">Militaire DANZ</option><option value="spouse">Conjoint(e)</option></select></td>
              <td data-label="Mot de passe"><button type="button" className="ghost-button table-password-button" onClick={() => openPasswordReset(profile)} disabled={busy}>Nouveau mot de passe</button></td>
              <td data-label="Actions"><div className="admin-table-actions"><button type="button" className="primary-button" disabled={busy || !dirty} onClick={() => saveRow(profile)}>{busy ? '…' : 'Enregistrer'}</button>{dirty&&<button type="button" className="ghost-button" disabled={busy} onClick={()=>resetRow(profile)}>Annuler</button>}<button type="button" className="ghost-button danger-action" disabled={busy || self} onClick={() => deleteUser(profile)}>Supprimer</button></div></td>
            </tr>
          })}</tbody>
        </table>
      </div>}
    </section>

    <section>
      <div className="admin-section-heading"><div><span className="eyebrow">Traçabilité</span><h2>Journal d’administration</h2></div><span>50 dernières actions</span></div>
      {audit.length === 0 ? <div className="empty-state">Aucune modification enregistrée pour le moment.</div> : <div className="admin-audit-list">{audit.map((entry) => <article key={entry.id}><div><strong>{auditLabels[entry.action] || entry.action}</strong><span>{auditTargetLabel(entry)}</span></div><small>{new Date(entry.created_at).toLocaleString('fr-FR')} · par {entry.actor_id ? nameById[entry.actor_id] || 'Administrateur' : 'ancien administrateur'}</small></article>)}</div>}
    </section>

    {passwordTarget && <div className="admin-password-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busyId !== passwordTarget.id) setPasswordTarget(null) }}>
      <form className="admin-password-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-password-title" onSubmit={replacePassword}>
        <span className="eyebrow">Sécurité du compte</span><h2 id="admin-password-title">Nouveau mot de passe</h2><p>Compte : <strong>{passwordTarget.full_name || passwordTarget.email}</strong></p>
        <label>Nouveau mot de passe<input type="password" autoFocus required minLength="10" maxLength="128" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="10 caractères minimum" /></label>
        <label>Confirmer le mot de passe<input type="password" required minLength="10" maxLength="128" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        <small>Au moins 10 caractères, dont une lettre et un chiffre. L’ancien mot de passe n’est jamais affiché.</small>
        <div className="admin-password-actions"><button className="primary-button" disabled={busyId === passwordTarget.id}>{busyId === passwordTarget.id ? 'Enregistrement…' : 'Remplacer le mot de passe'}</button><button type="button" className="ghost-button" disabled={busyId === passwordTarget.id} onClick={() => setPasswordTarget(null)}>Annuler</button></div>
      </form>
    </div>}
  </div>
}
