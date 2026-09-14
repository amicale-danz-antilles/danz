import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'

export default function Profile() {
  const { user, profile: authProfile, isAdmin } = useAuth()
  const [profile, setProfile] = useState(authProfile)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data, error: profileError } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (cancelled) return
      if (profileError) setError('Impossible de charger complètement votre profil pour le moment.')
      else if (data) setProfile(data)
    }
    load()
    return () => { cancelled = true }
  }, [user.id])

  const updatePassword = async (event) => {
    event.preventDefault(); setError(''); setMessage('')
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { setError('Le mot de passe doit contenir au moins 10 caractères, avec au moins une lettre et un chiffre.'); return }
    if (password !== confirm) { setError('Les deux mots de passe ne correspondent pas.'); return }
    setBusy(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) setError(updateError.message)
    else { setMessage('Votre nouveau mot de passe est enregistré. Il sera utilisé lors de votre prochaine connexion.'); setPassword(''); setConfirm('') }
    setBusy(false)
  }

  const roleLabel = isAdmin ? 'Administrateur' : 'Membre'
  const memberTags = []
  if (profile?.applicant_type === 'spouse') memberTags.push('Conjoint(e) militaire DANZ')
  else if (profile?.applicant_type === 'military' && profile?.military_reference === 'other') memberTags.push('Militaire hors DANZ')
  else if (profile?.applicant_type === 'military') memberTags.push('Militaire DANZ')
  if (profile?.is_amicaliste === true) memberTags.push('Amicaliste')
  else if (profile?.is_amicaliste === false) memberTags.push('Non-amicaliste')

  return <>
    <PageTitle eyebrow="Compte" title="Mon profil" text="Consultez votre compte, gérez votre mot de passe et accédez à vos préférences de notifications." />
    <div className="profile-card"><div className="profile-avatar">{(profile?.full_name || user.email || 'A')[0].toUpperCase()}</div><div><h2>{profile?.full_name || roleLabel}</h2><p>{user.email}</p><div className="profile-tags"><span className="role-badge">{roleLabel}</span>{memberTags.map((tag) => <span className="role-badge" key={tag}>{tag}</span>)}</div></div></div>

    {error && <div className="alert error">{error}</div>}{message && <div className="alert">{message}</div>}

    <div className="text-panel"><h2>Notifications</h2><p>Les réglages ont été regroupés dans une page dédiée : activation par appareil, Publications, Sondages, Albums et, pour les administrateurs, les demandes d’accès et les réglages globaux.</p><Link className="primary-button" to="/notifications">🔔 Gérer mes notifications</Link></div>

    <div className="text-panel"><h2>Mot de passe</h2><p>Membres et administrateurs utilisent le même mode de connexion : adresse e-mail + mot de passe. Vous pouvez modifier votre mot de passe ici sans changer vos droits ni votre statut amicaliste.</p><form className="profile-password-form" onSubmit={updatePassword}><label>Nouveau mot de passe<input type="password" minLength="10" maxLength="128" required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Confirmer le mot de passe<input type="password" minLength="10" maxLength="128" required autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label><button className="primary-button" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le mot de passe'}</button></form></div>
  </>
}
