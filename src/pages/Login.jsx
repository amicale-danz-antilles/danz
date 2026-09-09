import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function Login() {
  const { user, hasAccess, signIn, requestMembership, configured } = useAuth()
  const [registering, setRegistering] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [applicantType, setApplicantType] = useState('danz_military')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  if (user && hasAccess) return <Navigate to="/" replace />

  const clearMessages = () => { setError(''); setSuccess('') }
  const showRegistration = () => {
    clearMessages()
    setRegistering(true)
    setPassword('')
    setConfirmPassword('')
  }
  const showLogin = () => {
    clearMessages()
    setRegistering(false)
    setPassword('')
    setConfirmPassword('')
  }

  const submit = async (event) => {
    event.preventDefault()
    clearMessages()
    setBusy(true)

    try {
      if (registering) {
        if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
          throw new Error('Le mot de passe doit contenir au moins 10 caractères, avec au moins une lettre et un chiffre.')
        }
        if (password !== confirmPassword) throw new Error('Les deux mots de passe ne correspondent pas.')

        await requestMembership({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          applicantType,
          email,
          password,
        })

        setSuccess('Votre demande est enregistrée. Conservez votre mot de passe : dès que l’administrateur approuve votre compte, vous pourrez vous connecter directement avec cette adresse e-mail et ce mot de passe.')
        setRegistering(false)
        setFirstName('')
        setLastName('')
        setApplicantType('danz_military')
        setPassword('')
        setConfirmPassword('')
      } else {
        await signIn(email, password)
      }
    } catch (err) {
      const message = String(err?.message || '')
      if (/invalid login credentials/i.test(message)) setError('Adresse e-mail ou mot de passe incorrect.')
      else if (/email not confirmed/i.test(message)) setError('Cette adresse e-mail n’est pas encore utilisable. Contactez un administrateur.')
      else setError(message || 'Connexion impossible.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="login-page">
    <section className="login-visual">
      <div className="login-overlay">
        <div className="brand brand-light">
          <img src="/danz/Insigne%20CND%20-%20ANTILLES.png" alt="Insigne DANZ Antilles" style={{width:64,height:64,objectFit:'contain',borderRadius:'14px'}} />
          <div><strong>Amicale DANZ</strong><span>Antilles</span></div>
        </div>
        <div className="welcome-copy">
          <span className="eyebrow">Amicale DANZ Antilles</span>
          <h1>Espace privé<br />DANZ Antilles</h1>
          <p>Une seule connexion pour tous : membre ou administrateur, utilisez votre adresse e-mail et votre mot de passe. Les droits sont appliqués automatiquement après identification.</p>
        </div>
      </div>
    </section>

    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="mobile-logo"><img src="/danz/Insigne%20CND%20-%20ANTILLES.png" alt="Insigne DANZ Antilles" style={{width:72,height:72,objectFit:'contain'}} /></div>
        <span className="eyebrow">Amicale DANZ Antilles</span>
        <h2>{registering ? 'Demander un accès' : 'Connexion'}</h2>

        {!configured && <div className="alert warning"><strong>Configuration nécessaire.</strong><br />Le service d’authentification n’est pas configuré.</div>}
        {error && <div className="alert error">{error}</div>}
        {success && <div className="alert">{success}</div>}

        {registering ? <>
          <p className="muted">Créez vos identifiants une seule fois. Le compte reste bloqué jusqu’à validation par un administrateur ; après approbation, aucune nouvelle démarche n’est nécessaire.</p>

          <label>Nom<input type="text" required minLength="2" maxLength="80" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} /></label>
          <label>Prénom<input type="text" required minLength="2" maxLength="80" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
          <label>Situation<select required value={applicantType} onChange={(e) => setApplicantType(e.target.value)}><option value="danz_military">Militaire de la DANZ</option><option value="military_other">Militaire hors DANZ</option><option value="spouse">Conjoint(e) d’un militaire de la DANZ</option></select></label>
          <label>Adresse e-mail<input type="email" required autoComplete="email" placeholder="prenom.nom@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Mot de passe<input type="password" required minLength="10" autoComplete="new-password" placeholder="10 caractères minimum" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label>Confirmer le mot de passe<input type="password" required minLength="10" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></label>
          <p className="login-help">Le statut « amicaliste / non-amicaliste » et le suivi de cotisation sont gérés séparément par les administrateurs. La situation déclarée sert à identifier correctement le demandeur. <Link to="/confidentialite">Politique de confidentialité</Link>.</p>
          <button className="primary-button" disabled={busy || !configured}>{busy ? 'Création…' : 'Envoyer ma demande'}</button>
          <button type="button" className="ghost-button" onClick={showLogin}>J’ai déjà un compte</button>
        </> : <>
          <p className="muted">Utilisez les mêmes identifiants quel que soit votre rôle. Si votre compte est administrateur, l’espace Administration apparaîtra automatiquement.</p>
          <label>Adresse e-mail<input type="email" required autoComplete="email" placeholder="prenom.nom@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Mot de passe<input type="password" required autoComplete="current-password" placeholder="••••••••••" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="primary-button" disabled={busy || !configured}>{busy ? 'Connexion…' : 'Se connecter'}</button>

          <div style={{marginTop:'1.4rem',paddingTop:'1.2rem',borderTop:'1px solid #dce5e2'}}>
            <strong style={{display:'block',marginBottom:'.3rem'}}>Première visite ?</strong>
            <p className="muted" style={{marginBottom:'.7rem'}}>Créez votre compte et choisissez votre mot de passe. L’accès sera ouvert dès validation par un administrateur.</p>
            <button type="button" className="secondary-button" onClick={showRegistration}>Demander un accès</button>
          </div>
        </>}

        <p className="login-help" style={{textAlign:'center',marginTop:'1.2rem'}}><Link to="/confidentialite">Confidentialité et données personnelles</Link></p>
      </form>
    </section>
  </div>
}
