import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'

const VAPID_PUBLIC_KEY = 'BB0cZFeJlrnRo6sF9JN3pNwNhpkgaZJdxlKj0nO6XZ53r01WLCcPwkwPP42uUCFqsp7yLY50Le1X_dBw2RFcOUQ'

const preferenceLabels = {
  news: 'Actualités',
  events: 'Événements',
  documents: 'Documents',
  gallery: 'Photos / Galerie',
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

export default function Profile() {
  const { user, profile: authProfile, isAdmin } = useAuth()
  const [profile, setProfile] = useState(authProfile)
  const [preferences, setPreferences] = useState({ news: true, events: true, documents: true, gallery: true })
  const [pushStatus, setPushStatus] = useState('checking')
  const [pushBusy, setPushBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const [{ data: profileData }, { data: prefsData }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('notification_preferences').select('news, events, documents, gallery').eq('user_id', user.id).maybeSingle(),
      ])

      if (cancelled) return
      if (profileData) setProfile(profileData)
      if (prefsData) setPreferences(prefsData)

      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setPushStatus('unsupported')
        return
      }
      if (Notification.permission === 'denied') {
        setPushStatus('denied')
        return
      }

      try {
        const registration = await navigator.serviceWorker.getRegistration('/danz/')
        const subscription = await registration?.pushManager.getSubscription()
        setPushStatus(subscription ? 'enabled' : 'disabled')
      } catch (_) {
        setPushStatus('disabled')
      }
    }

    load()
    return () => { cancelled = true }
  }, [user.id])

  const enableNotifications = async () => {
    setError('')
    setMessage('')
    setPushBusy(true)
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error('Les notifications push ne sont pas disponibles sur ce navigateur.')
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushStatus(permission === 'denied' ? 'denied' : 'disabled')
        throw new Error('Les notifications n’ont pas été autorisées sur cet appareil.')
      }

      const registration = await navigator.serviceWorker.register('/danz/sw.js')
      await navigator.serviceWorker.ready

      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })
      }

      const json = subscription.toJSON()
      const { error: saveError } = await supabase.from('push_subscriptions').upsert({
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      }, { onConflict: 'endpoint' })
      if (saveError) throw saveError

      setPushStatus('enabled')
      setMessage('Notifications activées sur cet appareil.')
    } catch (err) {
      setError(err.message)
    } finally {
      setPushBusy(false)
    }
  }

  const disableNotifications = async () => {
    setError('')
    setMessage('')
    setPushBusy(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration('/danz/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        const { error: deleteError } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('user_id', user.id)
          .eq('endpoint', subscription.endpoint)
        if (deleteError) throw deleteError
        await subscription.unsubscribe()
      }
      setPushStatus('disabled')
      setMessage('Notifications désactivées sur cet appareil.')
    } catch (err) {
      setError(err.message)
    } finally {
      setPushBusy(false)
    }
  }

  const togglePreference = async (key) => {
    const previous = preferences
    const next = { ...preferences, [key]: !preferences[key] }
    setPreferences(next)
    setError('')

    const { error: updateError } = await supabase.from('notification_preferences').upsert({
      user_id: user.id,
      ...next,
    }, { onConflict: 'user_id' })

    if (updateError) {
      setPreferences(previous)
      setError('Impossible d’enregistrer cette préférence.')
    }
  }

  const updatePassword = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.')
      return
    }
    setBusy(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) setError(updateError.message)
    else {
      setMessage('Mot de passe administrateur enregistré.')
      setPassword('')
      setConfirm('')
    }
    setBusy(false)
  }

  const roleLabel = isAdmin ? 'Administrateur' : 'Membre'
  const memberTags = []
  if (!isAdmin) {
    memberTags.push(profile?.applicant_type === 'spouse' ? 'Conjoint(e)' : 'Militaire DANZ')
    if (profile?.is_amicaliste === true) memberTags.push('Amicaliste')
  }

  return <>
    <PageTitle eyebrow="Compte" title="Mon profil" text="Gérez votre accès et vos préférences de notifications." />

    <div className="profile-card">
      <div className="profile-avatar">{(profile?.full_name || user.email || 'A')[0].toUpperCase()}</div>
      <div>
        <h2>{profile?.full_name || roleLabel}</h2>
        <p>{user.email}</p>
        <div style={{display:'flex',gap:'.4rem',flexWrap:'wrap'}}>
          <span className="role-badge">{roleLabel}</span>
          {memberTags.map((tag) => <span className="role-badge" key={tag}>{tag}</span>)}
        </div>
      </div>
    </div>

    {error && <div className="alert error">{error}</div>}
    {message && <div className="alert">{message}</div>}

    <div className="text-panel">
      <h2>Notifications sur cet appareil</h2>
      <p>Activez les notifications pour être averti même lorsque l’application n’est pas ouverte au premier plan.</p>

      {pushStatus === 'enabled' ? (
        <button className="ghost-button" disabled={pushBusy} onClick={disableNotifications}>
          {pushBusy ? 'Traitement…' : 'Désactiver les notifications sur cet appareil'}
        </button>
      ) : pushStatus === 'denied' ? (
        <div className="alert warning">Les notifications sont bloquées dans les réglages de cet appareil. Autorisez-les pour l’application Amicale DANZ puis revenez ici.</div>
      ) : pushStatus === 'unsupported' ? (
        <div className="alert warning">Ce navigateur ne permet pas les notifications push. Sur iPhone/iPad, utilisez l’application ajoutée à l’écran d’accueil.</div>
      ) : (
        <button className="primary-button" disabled={pushBusy || pushStatus === 'checking'} onClick={enableNotifications}>
          {pushBusy ? 'Activation…' : pushStatus === 'checking' ? 'Vérification…' : 'Activer les notifications'}
        </button>
      )}

      {isAdmin && <p className="login-help">En tant qu’administrateur, toute nouvelle demande d’inscription vous sera notifiée dès que les notifications sont activées sur cet appareil.</p>}
    </div>

    <div className="text-panel">
      <h2>Publications à notifier</h2>
      <p>Choisissez les catégories pour lesquelles vous souhaitez recevoir une notification.</p>
      <div style={{ display: 'grid', gap: '.8rem', marginTop: '1rem' }}>
        {Object.entries(preferenceLabels).map(([key, label]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '.85rem 0', borderBottom: '1px solid rgba(20,55,65,.1)' }}>
            <span><strong>{label}</strong></span>
            <input
              type="checkbox"
              checked={preferences[key]}
              onChange={() => togglePreference(key)}
              style={{ width: '1.25rem', height: '1.25rem', flex: '0 0 auto' }}
            />
          </label>
        ))}
      </div>
    </div>

    {isAdmin ? (
      <div className="text-panel">
        <h2>Mot de passe administrateur</h2>
        <p>Le mot de passe est réservé aux comptes administrateurs.</p>
        <form onSubmit={updatePassword}>
          <label>Nouveau mot de passe
            <input type="password" minLength="8" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label>Confirmer le mot de passe
            <input type="password" minLength="8" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <button className="primary-button" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le mot de passe'}</button>
        </form>
      </div>
    ) : (
      <div className="text-panel">
        <h2>Connexion</h2>
        <p>Votre compte se connecte par adresse e-mail et lien sécurisé. Le site reconnaît automatiquement votre profil ; aucun choix de catégorie ni mot de passe n’est nécessaire.</p>
      </div>
    )}
  </>
}
