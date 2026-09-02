import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'

export default function Login() {
  const { user, hasAccess, requestMemberLogin, signInAdmin, configured } = useAuth()
  const [mode, setMode] = useState('member')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [applicantType, setApplicantType] = useState('military')
  const [militaryReference, setMilitaryReference] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  if (user && hasAccess) return <Navigate to="/" replace />

  const changeMode = (nextMode) => {
    setMode(nextMode)
    setError('')
    setSuccess('')
    setPassword('')
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBusy(true)

    try {
      if (mode === 'member') {
        await requestMemberLogin(email)
        setSuccess('Si cette adresse correspond à un compte amicaliste validé, un lien de connexion vient de vous être envoyé par e-mail.')
      } else if (mode === 'admin') {
        await signInAdmin(email.trim(), password)
      } else {
        const normalizedFirstName = firstName.trim()
        const normalizedLastName = lastName.trim()
        const fullName = `${normalizedFirstName} ${normalizedLastName}`.trim()
        const { error: requestError } = await supabase.from('membership_requests').insert({
          full_name: fullName,
          first_name: normalizedFirstName,
          last_name: normalizedLastName,
          applicant_type: applicantType,
          military_reference: applicantType === 'spouse' ? militaryReference.trim() : null,
          email: email.trim().toLowerCase(),
          message: message.trim() || null,
        })
        if (requestError) {
          if (requestError.code === '23505') throw new Error('Une demande est déjà en attente pour cette adresse e-mail.')
          throw requestError
        }
        setSuccess('Votre demande a bien été transmise au bureau. Aucun accès n’est créé avant validation par un administrateur.')
        setFirstName('')
        setLastName('')
        setApplicantType('military')
        setMilitaryReference('')
        setEmail('')
        setMessage('')
      }
    } catch (err) {
      setError(err.message === 'Invalid login credentials' ? 'Identifiants administrateur incorrects.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <section className="login-visual">
        <div className="login-overlay">
          <div className="brand brand-light"><div className="brand-mark">DA</div><div><strong>Amicale DANZ</strong><span>Antilles</span></div></div>
          <div className="welcome-copy"><span className="eyebrow">Bienvenue</span><h1>Notre amicale,<br />notre espace.</h1><p>Actualités, rendez-vous, documents et souvenirs de l'Amicale DANZ Antilles, réunis dans un espace réservé aux adhérents validés.</p></div>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-logo"><div className="brand-mark">DA</div></div>
          <span className="eyebrow">Espace privé</span>

          <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap',marginBottom:'1rem'}}>
            <button type="button" className={mode === 'member' ? 'primary-button' : 'ghost-button'} onClick={() => changeMode('member')}>Amicaliste</button>
            <button type="button" className={mode === 'admin' ? 'primary-button' : 'ghost-button'} onClick={() => changeMode('admin')}>Administrateur</button>
          </div>

          <h2>{mode === 'member' ? 'Connexion amicaliste' : mode === 'admin' ? 'Accès administrateur' : 'Demander un accès'}</h2>
          <p className="muted">
            {mode === 'member' && 'Saisissez uniquement l’adresse e-mail validée par le bureau. Vous recevrez un lien de connexion sécurisé.'}
            {mode === 'admin' && 'Connexion réservée aux administrateurs validés avec adresse e-mail et mot de passe.'}
            {mode === 'request' && 'Votre demande sera examinée manuellement avant toute création d’accès.'}
          </p>

          {!configured && <div className="alert warning"><strong>Configuration nécessaire.</strong><br />Les variables Supabase doivent être ajoutées avant la première connexion.</div>}
          {error && <div className="alert error">{error}</div>}
          {success && <div className="alert">{success}</div>}

          {mode === 'request' && <>
            <label>Prénom<input type="text" required minLength="2" maxLength="80" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
            <label>Nom<input type="text" required minLength="2" maxLength="80" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} /></label>
            <label>Vous êtes
              <select value={applicantType} onChange={(e) => setApplicantType(e.target.value)}>
                <option value="military">Militaire</option>
                <option value="spouse">Conjoint(e)</option>
              </select>
            </label>
            {applicantType === 'spouse' && <label>Nom et prénom du militaire de rattachement<input type="text" required minLength="2" maxLength="120" value={militaryReference} onChange={(e) => setMilitaryReference(e.target.value)} /></label>}
          </>}

          <label>Adresse e-mail<input type="email" required autoComplete="email" placeholder="prenom.nom@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} /></label>

          {mode === 'admin' && <label>Mot de passe<input type="password" required autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
          {mode === 'request' && <label>Message au bureau (facultatif)<textarea rows="3" maxLength="500" value={message} onChange={(e) => setMessage(e.target.value)} /></label>}

          <button className="primary-button" disabled={busy || !configured}>
            {busy ? 'Traitement…' : mode === 'member' ? 'Recevoir mon lien de connexion' : mode === 'admin' ? 'Se connecter' : 'Envoyer ma demande'}
          </button>

          {mode !== 'request' ? (
            <button type="button" className="ghost-button" onClick={() => changeMode('request')}>Je n’ai pas encore d’accès</button>
          ) : (
            <button type="button" className="ghost-button" onClick={() => changeMode('member')}>J’ai déjà un compte</button>
          )}

          <p className="login-help">Tous les nouveaux comptes, y compris administrateurs, doivent être validés par un administrateur existant.</p>
        </form>
      </section>
    </div>
  )
}
