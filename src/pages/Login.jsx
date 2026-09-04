import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_HOST = (() => {
  try { return new URL(SUPABASE_URL).host } catch { return 'service Supabase' }
})()

export default function Login() {
  const { user, hasAccess, requestMemberLogin, signInAdmin, configured } = useAuth()
  const [mode, setMode] = useState('standard')
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
  const [networkTest, setNetworkTest] = useState(null)
  const [testingNetwork, setTestingNetwork] = useState(false)

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

  const isNetworkFailure = (err) => {
    const message = String(err?.message || err || '').toLowerCase()
    return message.includes('networkerror') || message.includes('failed to fetch') || message.includes('network request failed') || message.includes('load failed')
  }

  const testNetwork = async () => {
    setTestingNetwork(true)
    setNetworkTest(null)
    try {
      if (!SUPABASE_URL) throw new Error('Supabase non configuré')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const started = performance.now()
      let response
      try {
        response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
      } finally {
        clearTimeout(timer)
      }
      const elapsed = Math.round(performance.now() - started)
      if (!response.ok) throw new Error(`Réponse HTTP ${response.status}`)
      setNetworkTest({
        ok: true,
        text: `Connexion au service d’authentification réussie (${elapsed} ms). Le réseau autorise ${SUPABASE_HOST}.`,
      })
    } catch (err) {
      const timeout = err?.name === 'AbortError'
      setNetworkTest({
        ok: false,
        text: `${timeout ? 'Le test a expiré.' : 'Le service d’authentification est inaccessible depuis ce réseau.'} Demandez à votre support informatique d’autoriser les connexions HTTPS (port 443) vers ${SUPABASE_HOST}.`,
      })
    } finally {
      setTestingNetwork(false)
    }
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
          requested_access: 'amicaliste',
          email: email.trim().toLowerCase(),
        })

        if (requestError) {
          if (requestError.code === '23505') throw new Error('Une demande est déjà en attente pour cette adresse e-mail.')
          throw requestError
        }

        setSuccess('Votre demande d’accès a bien été transmise. Après validation par un administrateur, vous pourrez vous connecter simplement avec votre adresse e-mail.')
        resetRegistration()
        setRegistering(false)
      } else if (mode === 'admin') {
        await signInAdmin(email, password)
      } else {
        await requestMemberLogin(email)
        setSuccess('Si cette adresse correspond à un compte validé, un lien de connexion sécurisé vient de vous être envoyé par e-mail.')
      }
    } catch (err) {
      if (isNetworkFailure(err)) {
        setError(`Impossible de joindre le service de connexion depuis ce réseau. Cela ressemble à un filtrage réseau de ${SUPABASE_HOST}. Lancez le diagnostic réseau ci-dessous.`)
      } else {
        setError(err.message === 'Invalid login credentials' ? 'Identifiants administrateur incorrects.' : err.message)
      }
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
            <span className="eyebrow">Amicale DANZ Antilles</span>
            <h1>Espace privé<br />DANZ Antilles</h1>
            <p>Membres : connectez-vous simplement avec votre adresse e-mail. Le site reconnaît automatiquement votre profil et vos accès.</p>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-logo">
            <img src="/danz/Insigne%20CND%20-%20ANTILLES.png" alt="Insigne DANZ Antilles" style={{width:72,height:72,objectFit:'contain'}} />
          </div>
          <span className="eyebrow">Amicale DANZ Antilles</span>
          <h2>{registering ? 'Demander un accès' : 'Connexion'}</h2>

          {!registering && <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'.65rem',margin:'1rem 0 1.25rem'}}>
            <button type="button" className={mode === 'standard' ? 'primary-button' : 'ghost-button'} style={{marginTop:0}} onClick={() => changeMode('standard')}>Connexion standard</button>
            <button type="button" className={mode === 'admin' ? 'primary-button' : 'ghost-button'} style={{marginTop:0}} onClick={() => changeMode('admin')}>Connexion admin</button>
          </div>}

          {!configured && <div className="alert warning"><strong>Configuration nécessaire.</strong><br />Les variables Supabase doivent être ajoutées avant la première connexion.</div>}
          {error && <div className="alert error">{error}</div>}
          {success && <div className="alert">{success}</div>}

          {registering ? (
            <>
              <p className="muted">Un seul formulaire suffit. Après validation, le site saura automatiquement si vous êtes militaire, conjoint(e), amicaliste ou non.</p>

              <label>Nom
                <input type="text" required minLength="2" maxLength="80" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </label>
              <label>Prénom
                <input type="text" required minLength="2" maxLength="80" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </label>
              <label>Situation
                <select required value={applicantType} onChange={(e) => setApplicantType(e.target.value)}>
                  <option value="military">Militaire DANZ</option>
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
              <button type="button" className="ghost-button" onClick={() => { setRegistering(false); setMode('standard'); setError(''); setSuccess('') }}>J’ai déjà un compte</button>
            </>
          ) : mode === 'admin' ? (
            <>
              <h3>Administrateur</h3>
              <p className="muted">Accès réservé aux administrateurs déjà enregistrés. Connexion avec adresse e-mail et mot de passe.</p>

              <label>Adresse e-mail
                <input type="email" required autoComplete="email" placeholder="prenom.nom@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label>Mot de passe
                <input type="password" required autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>

              <button className="primary-button" disabled={busy || !configured}>{busy ? 'Connexion…' : 'Se connecter comme admin'}</button>
              <p className="login-help">Les droits administrateur ne sont pas demandés depuis cette page : ils sont attribués par un administrateur existant.</p>
            </>
          ) : (
            <>
              <h3>Membre</h3>
              <p className="muted">Saisissez uniquement votre adresse e-mail. Si votre compte a été validé, vous recevrez un lien sécurisé de connexion.</p>

              <label>Adresse e-mail
                <input type="email" required autoComplete="email" placeholder="prenom.nom@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>

              <button className="primary-button" disabled={busy || !configured}>{busy ? 'Envoi…' : 'Recevoir mon lien de connexion'}</button>

              <div style={{marginTop:'1.4rem',paddingTop:'1.2rem',borderTop:'1px solid #dce5e2'}}>
                <strong style={{display:'block',marginBottom:'.3rem'}}>Première visite ?</strong>
                <p className="muted" style={{marginBottom:'.7rem'}}>Demandez votre accès une seule fois. Un administrateur validera ensuite votre compte.</p>
                <button type="button" className="secondary-button" onClick={() => { setRegistering(true); setError(''); setSuccess(''); setEmail('') }}>Demander un accès</button>
              </div>
            </>
          )}

          <div style={{marginTop:'1.35rem',paddingTop:'1rem',borderTop:'1px solid #dce5e2'}}>
            <button type="button" className="ghost-button" style={{marginTop:0}} disabled={testingNetwork || !configured} onClick={testNetwork}>
              {testingNetwork ? 'Test du réseau…' : 'Tester la connexion réseau'}
            </button>
            {networkTest && <div className={`alert ${networkTest.ok ? '' : 'error'}`} style={{marginTop:'.75rem'}}>
              <strong>{networkTest.ok ? 'Réseau compatible' : 'Accès réseau bloqué'}</strong><br />
              {networkTest.text}
              {!networkTest.ok && <><br /><br /><small>Information à transmettre au support réseau : autoriser HTTPS/443 vers <strong>{SUPABASE_HOST}</strong>. Le site ne demande aucune ouverture de port entrant.</small></>}
            </div>}
          </div>
        </form>
      </section>
    </div>
  )
}
