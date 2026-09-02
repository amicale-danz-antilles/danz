import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'

const accessLabels = {
  admin: 'Admin',
  amicaliste: 'Amicaliste',
  personnel_danz: 'Personnel de la DANZ',
}

export default function Login() {
  const { user, hasAccess, requestMemberLogin, signInAdmin, configured } = useAuth()
  const [mode, setMode] = useState(null)
  const [registering, setRegistering] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [applicantType, setApplicantType] = useState('military')
  const [isAmicaliste, setIsAmicaliste] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  if (user && hasAccess) return <Navigate to="/" replace />

  const changeMode = (nextMode) => {
    setMode(nextMode)
    setRegistering(false)
    setError('')
    setSuccess('')
    setPassword('')
  }

  const resetRegistration = () => {
    setFirstName('')
    setLastName('')
    setApplicantType('military')
    setIsAmicaliste('')
    setEmail('')
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBusy(true)

    try {
      if (registering) {
        const normalizedFirstName = firstName.trim()
        const normalizedLastName = lastName.trim()
        const fullName = `${normalizedFirstName} ${normalizedLastName}`.trim()

        const { error: requestError } = await supabase.from('membership_requests').insert({
          full_name: fullName,
          first_name: normalizedFirstName,
          last_name: normalizedLastName,
          applicant_type: applicantType,
          is_amicaliste: isAmicaliste === 'yes',
          requested_access: mode,
          email: email.trim().toLowerCase(),
        })

        if (requestError) {
          if (requestError.code === '23505') throw new Error('Une demande est déjà en attente pour cette adresse e-mail.')
          throw requestError
        }

        setSuccess(`Votre demande « ${accessLabels[mode]} » a bien été transmise. Un administrateur doit la valider avant toute connexion.`)
        resetRegistration()
        setRegistering(false)
      } else if (mode === 'admin') {
        await signInAdmin(email, password)
      } else {
        await requestMemberLogin(email, mode)
        setSuccess('Si cette adresse correspond à un compte validé dans cette catégorie, un lien de connexion vient de vous être envoyé par e-mail.')
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
          <div className="brand brand-light">
            <img src="/danz/Insigne%20CND%20-%20ANTILLES.png" alt="Insigne DANZ Antilles" style={{width:64,height:64,objectFit:'contain',borderRadius:'14px'}} />
            <div><strong>Amicale DANZ</strong><span>Antilles</span></div>
          </div>
          <div className="welcome-copy">
            <span className="eyebrow">Bienvenue</span>
            <h1>Espace privé<br />DANZ Antilles</h1>
            <p>Choisissez votre type d’accès. Toute nouvelle inscription doit être approuvée par un administrateur.</p>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-logo">
            <img src="/danz/Insigne%20CND%20-%20ANTILLES.png" alt="Insigne DANZ Antilles" style={{width:72,height:72,objectFit:'contain'}} />
          </div>
          <span className="eyebrow">Espace privé</span>
          <h2>Choisissez votre accès</h2>

          <div style={{display:'grid',gridTemplateColumns:'1fr',gap:'.65rem',margin:'1rem 0 1.25rem'}}>
            <button type="button" className={mode === 'admin' ? 'primary-button' : 'ghost-button'} onClick={() => changeMode('admin')}>Admin</button>
            <button type="button" className={mode === 'amicaliste' ? 'primary-button' : 'ghost-button'} onClick={() => changeMode('amicaliste')}>Amicaliste</button>
            <button type="button" className={mode === 'personnel_danz' ? 'primary-button' : 'ghost-button'} onClick={() => changeMode('personnel_danz')}>Personnel de la DANZ</button>
          </div>

          {!configured && <div className="alert warning"><strong>Configuration nécessaire.</strong><br />Les variables Supabase doivent être ajoutées avant la première connexion.</div>}
          {error && <div className="alert error">{error}</div>}
          {success && <div className="alert">{success}</div>}

          {!mode ? (
            <p className="muted">Sélectionnez votre catégorie pour vous connecter ou demander un accès.</p>
          ) : registering ? (
            <>
              <h3>Demande d’accès — {accessLabels[mode]}</h3>
              <p className="muted">La demande restera en attente jusqu’à validation par un administrateur.</p>

              <label>Nom
                <input type="text" required minLength="2" maxLength="80" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </label>
              <label>Prénom
                <input type="text" required minLength="2" maxLength="80" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </label>
              <label>Situation
                <select required value={applicantType} onChange={(e) => setApplicantType(e.target.value)}>
                  <option value="military">Militaire</option>
                  <option value="spouse">Conjoint(e)</option>
                </select>
              </label>
              <label>Êtes-vous amicaliste ?
                <select required value={isAmicaliste} onChange={(e) => setIsAmicaliste(e.target.value)}>
                  <option value="" disabled>Choisir</option>
                  <option value="yes">Oui</option>
                  <option value="no">Non</option>
                </select>
              </label>
              <label>Adresse e-mail
                <input type="email" required autoComplete="email" placeholder="prenom.nom@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>

              <button className="primary-button" disabled={busy || !configured}>{busy ? 'Envoi…' : 'Envoyer ma demande'}</button>
              <button type="button" className="ghost-button" onClick={() => { setRegistering(false); setError(''); setSuccess('') }}>Retour à la connexion</button>
            </>
          ) : (
            <>
              <h3>{accessLabels[mode]}</h3>
              <p className="muted">
                {mode === 'admin'
                  ? 'Connexion par adresse e-mail et mot de passe. Le compte doit avoir été validé comme administrateur.'
                  : 'Connexion par adresse e-mail uniquement. Après validation, un lien sécurisé vous est envoyé par e-mail.'}
              </p>

              <label>Adresse e-mail
                <input type="email" required autoComplete="email" placeholder="prenom.nom@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>

              {mode === 'admin' && <label>Mot de passe
                <input type="password" required autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>}

              <button className="primary-button" disabled={busy || !configured}>
                {busy ? 'Traitement…' : mode === 'admin' ? 'Se connecter' : 'Recevoir mon lien de connexion'}
              </button>
              <button type="button" className="ghost-button" onClick={() => { setRegistering(true); setError(''); setSuccess('') }}>Demander un accès</button>
            </>
          )}

          <p className="login-help">Aucun nouveau compte n’accède au site sans validation préalable d’un administrateur.</p>
        </form>
      </section>
    </div>
  )
}
