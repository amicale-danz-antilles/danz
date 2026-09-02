import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'

export default function Login() {
  const { user, signIn, configured } = useAuth()
  const [mode, setMode] = useState('login')
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

  if (user) return <Navigate to="/" replace />

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password)
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
        setSuccess('Votre demande a bien été transmise au bureau. Vous recevrez une invitation après validation.')
        setFirstName('')
        setLastName('')
        setApplicantType('military')
        setMilitaryReference('')
        setEmail('')
        setMessage('')
      }
    } catch (err) {
      setError(err.message === 'Invalid login credentials' ? 'Identifiants incorrects.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <section className="login-visual">
        <div className="login-overlay">
          <div className="brand brand-light"><div className="brand-mark">DA</div><div><strong>Amicale DANZ</strong><span>Antilles</span></div></div>
          <div className="welcome-copy"><span className="eyebrow">Bienvenue</span><h1>Notre amicale,<br />notre espace.</h1><p>Actualités, rendez-vous, documents et souvenirs de l'Amicale DANZ Antilles, réunis dans un espace réservé aux adhérents.</p></div>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-logo"><div className="brand-mark">DA</div></div>
          <span className="eyebrow">Espace privé</span>
          <h2>{mode === 'login' ? 'Connexion amicaliste' : 'Demander un accès'}</h2>
          <p className="muted">{mode === 'login' ? "Utilisez l'adresse e-mail enregistrée par le bureau de l'amicale." : "Votre demande sera examinée par un administrateur avant la création de votre accès."}</p>
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
          {mode === 'login' ? (
            <label>Mot de passe<input type="password" required autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          ) : (
            <label>Message au bureau (facultatif)<textarea rows="3" maxLength="500" value={message} onChange={(e) => setMessage(e.target.value)} /></label>
          )}
          <button className="primary-button" disabled={busy || !configured}>{busy ? 'Traitement…' : mode === 'login' ? 'Se connecter' : 'Envoyer ma demande'}</button>
          <button type="button" className="ghost-button" onClick={() => { setMode(mode === 'login' ? 'request' : 'login'); setError(''); setSuccess('') }}>
            {mode === 'login' ? "Je n'ai pas encore d'accès" : 'J’ai déjà un compte'}
          </button>
          <p className="login-help">Les nouveaux accès sont validés manuellement par le bureau de l’amicale.</p>
        </form>
      </section>
    </div>
  )
}
