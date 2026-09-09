import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../admin-users.css'

const CURRENT_YEAR = new Date().getFullYear()

const auditLabels = {
  user_access_updated: 'Compte / statut modifié',
  user_suspended: 'Compte suspendu',
  user_deleted: 'Compte et données personnelles supprimés',
  user_password_reset_by_admin: 'Mot de passe remplacé par un administrateur',
  membership_approved: 'Demande d’accès approuvée',
  membership_rejected: 'Demande d’accès refusée',
  data_exported: 'Sauvegarde / export des données',
}

const situationLabel = (profile) => {
  if (profile?.applicant_type === 'spouse') return 'Conjoint(e) d’un militaire de la DANZ'
  if (profile?.military_reference === 'other') return 'Militaire hors DANZ'
  if (profile?.applicant_type === 'military' || profile?.military_reference === 'danz') return 'Militaire de la DANZ'
  return 'Situation non renseignée'
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
  const [dues, setDues] = useState({})
  const [duesReady, setDuesReady] = useState(false)
  const [audit, setAudit] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [duesBusyId, setDuesBusyId] = useState(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [passwordTarget, setPasswordTarget] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const load = async ({ keepSelection = true } = {}) => {
    setLoading(true)
    setError('')
    const [profilesResult, duesResult, auditResult] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name', { ascending: true }),
      supabase.from('membership_dues').select('user_id,year,paid,paid_at,updated_at').eq('year', CURRENT_YEAR),
      supabase.from('admin_audit_log').select('id,actor_id,action,target_user_id,created_at').order('created_at', { ascending: false }).limit(50),
    ])
    if (profilesResult.error) setError(profilesResult.error.message)
    if (auditResult.error) setError((current) => current || auditResult.error.message)
    const rows = profilesResult.data || []
    setProfiles(rows)
    setAudit(auditResult.data || [])
    if (duesResult.error) {
      setDuesReady(false)
      setDues({})
    } else {
      setDuesReady(true)
      setDues(Object.fromEntries((duesResult.data || []).map((entry) => [entry.user_id, entry])))
    }
    if (keepSelection && selectedId) {
      const fresh = rows.find((profile) => profile.id === selectedId)
      if (fresh) setDraft(valuesFor(fresh))
      else { setSelectedId(null); setDraft(null) }
    }
    setLoading(false)
  }

  useEffect(() => {
    if (isAdmin) load({ keepSelection: false })
    else if (!authLoading) setLoading(false)
  }, [isAdmin, authLoading])

  useEffect(() => {
    if (!selectedId && !passwordTarget) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (passwordTarget && busyId !== passwordTarget.id) setPasswordTarget(null)
      else if (!busyId && !duesBusyId) { setSelectedId(null); setDraft(null) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [selectedId, passwordTarget, busyId, duesBusyId])

  if (!authLoading && !isAdmin) return <Navigate to="/" replace />

  const counts = useMemo(() => ({
    total: profiles.length,
    active: profiles.filter((profile) => profile.active).length,
    admins: profiles.filter((profile) => profile.active && profile.role === 'admin').length,
    amicalistes: profiles.filter((profile) => profile.is_amicaliste === true).length,
    duesPaid: profiles.filter((profile) => profile.is_amicaliste === true && dues[profile.id]?.paid === true).length,
  }), [profiles, dues])

  const filteredProfiles = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return profiles
    return profiles.filter((profile) => `${profile.full_name || ''} ${profile.email || ''} ${situationLabel(profile)}`.toLowerCase().includes(needle))
  }, [profiles, query])

  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === selectedId) || null, [profiles, selectedId])
  const nameById = useMemo(() => Object.fromEntries(profiles.map((profile) => [profile.id, profile.full_name || profile.email || 'Utilisateur'])), [profiles])
  const dirty = selectedProfile && draft ? !sameValues(draft, valuesFor(selectedProfile)) : false

  const openUser = (profile) => {
    setError('')
    setSuccess('')
    setSelectedId(profile.id)
    setDraft(valuesFor(profile))
  }

  const closeUser = () => {
    if (busyId || duesBusyId) return
    if (dirty && !window.confirm('Abandonner les modifications non enregistrées ?')) return
    setSelectedId(null)
    setDraft(null)
  }

  const saveUser = async () => {
    if (!selectedProfile || !draft || !dirty) return
    setBusyId(selectedProfile.id)
    setError('')
    setSuccess('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('admin-user-management', {
        body: {
          action: 'set-access',
          userId: selectedProfile.id,
          active: draft.active,
          role: draft.role,
          applicantType: draft.applicant_type || null,
          isAmicaliste: draft.is_amicaliste === 'yes',
        },
      })
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'Impossible de modifier ce compte.')
      setSuccess(`Compte de ${selectedProfile.full_name || selectedProfile.email} mis à jour.`)
      await load()
    } catch (err) {
      setError(err.message || 'Impossible de modifier ce compte.')
    } finally {
      setBusyId(null)
    }
  }

  const setDuePaid = async (profile, paid) => {
    if (!duesReady || !profile?.id) return
    setDuesBusyId(profile.id)
    setError('')
    setSuccess('')
    try {
      const now = new Date().toISOString()
      const { error: dueError } = await supabase.from('membership_dues').upsert({
        user_id: profile.id,
        year: CURRENT_YEAR,
        paid,
        paid_at: paid ? now : null,
        updated_by: user.id,
        updated_at: now,
      }, { onConflict: 'user_id,year' })
      if (dueError) throw dueError
      setSuccess(paid ? `Cotisation ${CURRENT_YEAR} marquée comme réglée pour ${profile.full_name || profile.email}.` : `Cotisation ${CURRENT_YEAR} marquée comme non réglée pour ${profile.full_name || profile.email}.`)
      await load()
    } catch (err) {
      setError(err.message || 'Impossible de mettre à jour la cotisation.')
    } finally {
      setDuesBusyId(null)
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
      setSuccess(`Nouveau mot de passe enregistré pour ${label}.`)
      await load()
    } catch (err) {
      setError(err.message || 'Impossible de remplacer le mot de passe.')
    } finally {
      setBusyId(null)
    }
  }

  const deleteUser = async (profile) => {
    const answer = window.prompt(`Suppression RGPD définitive de ${profile.full_name || profile.email}.\n\nTapez SUPPRIMER pour confirmer.`)
    if (answer !== 'SUPPRIMER') return
    setBusyId(profile.id)
    setError('')
    setSuccess('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('admin-user-management', { body: { action: 'delete', userId: profile.id } })
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'Suppression impossible.')
      setSelectedId(null)
      setDraft(null)
      setSuccess('Le compte et ses données personnelles directement rattachées ont été supprimés.')
      await load({ keepSelection: false })
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

  const dueBadge = (profile) => {
    if (!duesReady) return null
    if (!profile.is_amicaliste) return <span className="admin-state-badge neutral">Cotisation —</span>
    return dues[profile.id]?.paid
      ? <span className="admin-state-badge fee-ok">Cotisation {CURRENT_YEAR} ✓</span>
      : <span className="admin-state-badge fee-due">Cotisation {CURRENT_YEAR} à régler</span>
  }

  return <div className="admin-users-page">
    <PageTitle eyebrow="Administration · Membres" title="Utilisateurs" text="Touchez un utilisateur pour consulter sa situation et gérer ses droits, son statut amicaliste et sa cotisation annuelle." />

    <div className="admin-user-stats">
      <article><strong>{counts.total}</strong><span>comptes</span></article>
      <article><strong>{counts.active}</strong><span>actifs</span></article>
      <article><strong>{counts.amicalistes}</strong><span>amicalistes</span></article>
      <article><strong>{duesReady ? `${counts.duesPaid}/${counts.amicalistes}` : counts.admins}</strong><span>{duesReady ? `cotisations ${CURRENT_YEAR} réglées` : 'admins'}</span></article>
    </div>

    {error && <div className="alert error">{error}</div>}
    {success && <div className="alert">{success}</div>}

    <section>
      <div className="admin-section-heading"><div><span className="eyebrow">Base membres</span><h2>Liste des utilisateurs</h2></div><span>{filteredProfiles.length} affiché{filteredProfiles.length > 1 ? 's' : ''}</span></div>
      <div className="admin-user-toolbar"><input type="search" placeholder="Rechercher un nom, e-mail ou situation…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>

      {loading ? <div className="skeleton-card" /> : profiles.length === 0 ? <div className="empty-state">Aucun compte.</div> : filteredProfiles.length === 0 ? <div className="empty-state">Aucun utilisateur ne correspond à cette recherche.</div> : <div className="admin-member-list">
        {filteredProfiles.map((profile) => {
          const self = profile.id === user?.id
          return <button type="button" className={`admin-member-row ${profile.active ? '' : 'is-suspended'}`} key={profile.id} onClick={() => openUser(profile)}>
            <span className="admin-user-avatar">{(profile.full_name || profile.email || '?')[0].toUpperCase()}</span>
            <span className="admin-member-identity"><strong>{profile.full_name || 'Nom non renseigné'}</strong><small>{profile.email}</small><em>{situationLabel(profile)}</em></span>
            <span className="admin-member-badges">
              <span className={`admin-state-badge ${profile.active ? 'ok' : 'off'}`}>{profile.active ? 'Actif' : 'Suspendu'}</span>
              <span className={`admin-state-badge ${profile.is_amicaliste ? 'member' : 'neutral'}`}>{profile.is_amicaliste ? 'Amicaliste' : 'Non-amicaliste'}</span>
              {dueBadge(profile)}
              {profile.role === 'admin' && <span className="admin-state-badge admin">Admin</span>}
              {self && <span className="admin-state-badge self">Vous</span>}
            </span>
            <span className="admin-member-chevron" aria-hidden="true">›</span>
          </button>
        })}
      </div>}
    </section>

    <section className="admin-audit-section">
      <details>
        <summary>Journal d’administration · 50 dernières actions</summary>
        {audit.length === 0 ? <div className="empty-state">Aucune modification enregistrée pour le moment.</div> : <div className="admin-audit-list">{audit.map((entry) => <article key={entry.id}><div><strong>{auditLabels[entry.action] || entry.action}</strong><span>{auditTargetLabel(entry)}</span></div><small>{new Date(entry.created_at).toLocaleString('fr-FR')} · par {entry.actor_id ? nameById[entry.actor_id] || 'Administrateur' : 'ancien administrateur'}</small></article>)}</div>}
      </details>
    </section>

    {selectedProfile && draft && <div className="admin-user-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeUser() }}>
      <section className="admin-user-sheet" role="dialog" aria-modal="true" aria-labelledby="admin-user-sheet-title">
        <div className="admin-user-sheet-head"><div className="admin-table-user"><span className="admin-user-avatar large">{(selectedProfile.full_name || selectedProfile.email || '?')[0].toUpperCase()}</span><div><span className="eyebrow">Gestion du compte</span><h2 id="admin-user-sheet-title">{selectedProfile.full_name || 'Utilisateur'}</h2><small>{selectedProfile.email}</small></div></div><button type="button" className="admin-sheet-close" aria-label="Fermer" onClick={closeUser}>×</button></div>

        <div className="admin-user-sheet-summary">
          <span>{selectedProfile.active ? '● Accès actif' : '○ Accès suspendu'}</span>
          <span>{draft.is_amicaliste === 'yes' ? '✓ Amicaliste' : 'Non-amicaliste'}</span>
          <span>{situationLabel(selectedProfile)}</span>
        </div>

        <div className="admin-user-edit-grid">
          <label>Accès<select value={draft.active ? 'active' : 'suspended'} disabled={busyId === selectedProfile.id || selectedProfile.id === user?.id} onChange={(event) => setDraft({ ...draft, active: event.target.value === 'active' })}><option value="active">Actif</option><option value="suspended">Suspendu</option></select></label>
          <label>Rôle<select value={draft.role} disabled={busyId === selectedProfile.id || selectedProfile.id === user?.id} onChange={(event) => setDraft({ ...draft, role: event.target.value })}><option value="member">Membre</option><option value="admin">Administrateur</option></select></label>
          <label>Statut amicale<select value={draft.is_amicaliste} disabled={busyId === selectedProfile.id} onChange={(event) => setDraft({ ...draft, is_amicaliste: event.target.value })}><option value="yes">Amicaliste</option><option value="no">Non-amicaliste</option></select></label>
          <div className="admin-user-readonly-field"><span>Situation déclarée</span><strong>{situationLabel(selectedProfile)}</strong></div>
        </div>

        {duesReady && <section className={`admin-dues-card ${selectedProfile.is_amicaliste ? '' : 'disabled'}`}>
          <div><span className="eyebrow">Cotisation annuelle</span><h3>{CURRENT_YEAR}</h3><p>{selectedProfile.is_amicaliste ? dues[selectedProfile.id]?.paid ? `Réglée${dues[selectedProfile.id]?.paid_at ? ` le ${new Date(dues[selectedProfile.id].paid_at).toLocaleDateString('fr-FR')}` : ''}.` : 'Cotisation à régulariser.' : 'Ce compte est actuellement non-amicaliste.'}</p></div>
          {selectedProfile.is_amicaliste && <button type="button" className={dues[selectedProfile.id]?.paid ? 'secondary-button' : 'primary-button'} disabled={duesBusyId === selectedProfile.id} onClick={() => setDuePaid(selectedProfile, !dues[selectedProfile.id]?.paid)}>{duesBusyId === selectedProfile.id ? 'Enregistrement…' : dues[selectedProfile.id]?.paid ? 'Marquer non réglée' : `Marquer payée ${CURRENT_YEAR}`}</button>}
        </section>}

        <div className="privacy-note admin-user-help"><strong>Amicaliste, cotisation et accès sont séparés.</strong><br/>Le statut amicaliste indique l’adhésion à l’Amicale. La cotisation est suivie année par année. Suspendre un compte coupe son accès au site sans modifier ces deux informations.</div>

        <div className="admin-user-sheet-actions">
          <button type="button" className="primary-button" disabled={busyId === selectedProfile.id || !dirty} onClick={saveUser}>{busyId === selectedProfile.id ? 'Enregistrement…' : dirty ? 'Enregistrer les modifications' : 'Aucune modification'}</button>
          {dirty && <button type="button" className="secondary-button" disabled={busyId === selectedProfile.id} onClick={() => setDraft(valuesFor(selectedProfile))}>Annuler les changements</button>}
          <button type="button" className="secondary-button" disabled={busyId === selectedProfile.id} onClick={() => openPasswordReset(selectedProfile)}>Changer le mot de passe</button>
          <button type="button" className="ghost-button danger-action" disabled={busyId === selectedProfile.id || selectedProfile.id === user?.id} onClick={() => deleteUser(selectedProfile)}>Supprimer définitivement le compte</button>
        </div>
      </section>
    </div>}

    {passwordTarget && <div className="admin-password-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busyId !== passwordTarget.id) setPasswordTarget(null) }}>
      <form className="admin-password-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-password-title" onSubmit={replacePassword}>
        <span className="eyebrow">Sécurité du compte</span><h2 id="admin-password-title">Nouveau mot de passe</h2><p>Compte : <strong>{passwordTarget.full_name || passwordTarget.email}</strong></p>
        <label>Nouveau mot de passe<input type="password" autoFocus required minLength="10" maxLength="128" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="10 caractères minimum" /></label>
        <label>Confirmer le mot de passe<input type="password" required minLength="10" maxLength="128" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        <small>Au moins 10 caractères, dont une lettre et un chiffre. Le mot de passe actuel n’est jamais affiché.</small>
        <div className="admin-password-actions"><button className="primary-button" disabled={busyId === passwordTarget.id}>{busyId === passwordTarget.id ? 'Enregistrement…' : 'Remplacer le mot de passe'}</button><button type="button" className="ghost-button" disabled={busyId === passwordTarget.id} onClick={() => setPasswordTarget(null)}>Annuler</button></div>
      </form>
    </div>}
  </div>
}
