import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../notifications.css'

const VAPID_PUBLIC_KEY = 'BB0cZFeJlrnRo6sF9JN3pNwNhpkgaZJdxlKj0nO6XZ53r01WLCcPwkwPP42uUCFqsp7yLY50Le1X_dBw2RFcOUQ'
const MEMBER_PREFS = [
  ['news', 'Actualités', 'Nouvelles informations publiées par le bureau.'],
  ['events', 'Événements', 'Nouveaux rendez-vous et événements programmés.'],
  ['gallery', 'Albums', 'Nouveaux albums et souvenirs disponibles.'],
]
const ADMIN_GLOBAL = [
  ['enabled', 'Service de notifications', 'Interrupteur général pour tous les envois push du site.'],
  ['news', 'Actualités', 'Autoriser les notifications liées aux actualités.'],
  ['events', 'Événements', 'Autoriser les notifications liées aux événements.'],
  ['gallery', 'Albums', 'Autoriser les notifications liées aux albums.'],
  ['membership_requests', 'Demandes d’accès', 'Autoriser les alertes envoyées aux administrateurs lors d’une nouvelle demande.'],
]

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

const subscriptionPayload = (subscription, userId) => {
  const json = subscription.toJSON()
  return { user_id: userId, endpoint: subscription.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }
}

export default function Notifications() {
  const { user, isAdmin } = useAuth()
  const [online, setOnline] = useState(() => navigator.onLine)
  const [preferences, setPreferences] = useState({ news: true, events: true, gallery: true, membership_requests: true })
  const [pushStatus, setPushStatus] = useState('checking')
  const [pushBusy, setPushBusy] = useState(false)
  const [globalSettings, setGlobalSettings] = useState({ enabled: true, news: true, events: true, gallery: true, membership_requests: true })
  const [globalBusy, setGlobalBusy] = useState('')
  const [stats, setStats] = useState({ devices: 0, users: 0, news: 0, events: 0, gallery: 0, membership_requests: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const visiblePreferences = useMemo(() => isAdmin ? [...MEMBER_PREFS, ['membership_requests', 'Demandes d’accès', 'Être prévenu personnellement lorsqu’une nouvelle demande d’inscription arrive.']] : MEMBER_PREFS, [isAdmin])

  const checkDevice = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setPushStatus('unsupported'); return }
    if (Notification.permission === 'denied') { setPushStatus('denied'); return }
    try {
      const registration = await navigator.serviceWorker.getRegistration('/danz/')
      const subscription = await registration?.pushManager.getSubscription()
      if (!subscription) { setPushStatus('disabled'); return }
      const { error: syncError } = await supabase.from('push_subscriptions').upsert(subscriptionPayload(subscription, user.id), { onConflict: 'endpoint' })
      if (syncError) throw syncError
      setPushStatus('enabled')
    } catch (_) {
      setPushStatus('disabled')
    }
  }

  const load = async () => {
    if (!user?.id || !navigator.onLine) { setLoading(false); return }
    setLoading(true); setError('')
    const requests = [supabase.from('notification_preferences').select('news,events,gallery,membership_requests').eq('user_id', user.id).maybeSingle()]
    if (isAdmin) {
      requests.push(supabase.from('notification_settings').select('enabled,news,events,gallery,membership_requests').eq('id', 1).single())
      requests.push(supabase.from('push_subscriptions').select('id', { count: 'exact', head: true }))
      requests.push(supabase.from('notification_preferences').select('news,events,gallery,membership_requests'))
    }
    const results = await Promise.all(requests)
    const ownPrefs = results[0]
    if (ownPrefs.error) setError('Impossible de charger vos préférences de notifications.')
    else if (ownPrefs.data) setPreferences((current) => ({ ...current, ...ownPrefs.data }))

    if (isAdmin) {
      const settingsResult = results[1]
      const subscriptionsResult = results[2]
      const prefsResult = results[3]
      if (!settingsResult.error && settingsResult.data) setGlobalSettings(settingsResult.data)
      const rows = prefsResult?.data || []
      setStats({
        devices: subscriptionsResult?.count || 0,
        users: rows.length,
        news: rows.filter((row) => row.news !== false).length,
        events: rows.filter((row) => row.events !== false).length,
        gallery: rows.filter((row) => row.gallery !== false).length,
        membership_requests: rows.filter((row) => row.membership_requests !== false).length,
      })
    }
    await checkDevice()
    setLoading(false)
  }

  useEffect(() => { load() }, [user?.id, isAdmin])
  useEffect(() => {
    const onOnline = () => { setOnline(true); load() }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [user?.id, isAdmin])

  const subscribeCurrentDevice = async (registration) => {
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) })
    const { error: saveError } = await supabase.from('push_subscriptions').upsert(subscriptionPayload(subscription, user.id), { onConflict: 'endpoint' })
    if (saveError) throw saveError
  }

  const enableNotifications = async () => {
    if (!online) return setError('Reconnectez l’appareil pour modifier les notifications.')
    setError(''); setMessage(''); setPushBusy(true)
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Les notifications push ne sont pas disponibles sur ce navigateur.')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushStatus(permission === 'denied' ? 'denied' : 'disabled')
        throw new Error('Les notifications n’ont pas été autorisées sur cet appareil.')
      }
      const registration = await navigator.serviceWorker.register('/danz/sw.js')
      await navigator.serviceWorker.ready
      await subscribeCurrentDevice(registration)
      setPushStatus('enabled')
      setMessage('Notifications activées sur cet appareil.')
      if (isAdmin) await load()
    } catch (err) {
      setError(err.message || 'Impossible d’activer les notifications sur cet appareil.')
    } finally { setPushBusy(false) }
  }

  const disableNotifications = async () => {
    if (!online) return setError('Reconnectez l’appareil pour modifier les notifications.')
    setError(''); setMessage(''); setPushBusy(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration('/danz/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        const { error: deleteError } = await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', subscription.endpoint)
        if (deleteError) throw deleteError
        await subscription.unsubscribe()
      }
      setPushStatus('disabled')
      setMessage('Notifications désactivées sur cet appareil.')
      if (isAdmin) await load()
    } catch (err) { setError(err.message || 'Impossible de désactiver les notifications.') } finally { setPushBusy(false) }
  }

  const togglePreference = async (key) => {
    if (!online) return setError('Reconnectez l’appareil pour modifier vos préférences.')
    const previous = preferences
    const next = { ...preferences, [key]: !preferences[key] }
    setPreferences(next); setError(''); setMessage('')
    const { error: updateError } = await supabase.from('notification_preferences').upsert({ user_id: user.id, ...next }, { onConflict: 'user_id' })
    if (updateError) { setPreferences(previous); setError('Impossible d’enregistrer cette préférence.') }
    else setMessage('Vos préférences ont été enregistrées.')
  }

  const toggleGlobal = async (key) => {
    if (!isAdmin || globalBusy || !online) return
    const previous = globalSettings
    const next = { ...globalSettings, [key]: !globalSettings[key] }
    setGlobalSettings(next); setGlobalBusy(key); setError(''); setMessage('')
    const { error: updateError } = await supabase.from('notification_settings').update({ [key]: next[key], updated_by: user.id }).eq('id', 1)
    if (updateError) { setGlobalSettings(previous); setError('Impossible d’enregistrer le réglage administrateur.') }
    else setMessage('Réglage global des notifications enregistré.')
    setGlobalBusy('')
  }

  return <div className="notifications-page">
    <PageTitle eyebrow="Préférences" title="Notifications" text="Activez les notifications sur cet appareil et choisissez à tout moment les informations que vous souhaitez recevoir." />
    {!online && <div className="alert warning">Mode hors ligne · vos réglages restent visibles, mais une connexion Internet est nécessaire pour les modifier.</div>}
    {error && <div className="alert error">{error}</div>}
    {message && <div className="alert success">{message}</div>}

    <section className="text-panel notification-device-panel">
      <div><span className="eyebrow">Cet appareil</span><h2>Réception des notifications push</h2><p>Ce réglage est propre à ce téléphone, cette tablette ou cet ordinateur. Vos catégories ci-dessous sont liées à votre compte.</p></div>
      <div className={`notification-status ${pushStatus}`}><strong>{pushStatus === 'enabled' ? 'Activées' : pushStatus === 'denied' ? 'Bloquées par l’appareil' : pushStatus === 'unsupported' ? 'Non prises en charge' : pushStatus === 'checking' ? 'Vérification…' : 'Désactivées'}</strong></div>
      {pushStatus === 'enabled'
        ? <button className="ghost-button" disabled={pushBusy || !online} onClick={disableNotifications}>{pushBusy ? 'Traitement…' : 'Désactiver sur cet appareil'}</button>
        : pushStatus === 'denied'
          ? <p className="privacy-note">Les notifications sont bloquées dans les réglages du navigateur ou du système. Autorisez-les pour Amicale DANZ puis revenez sur cette page.</p>
          : pushStatus === 'unsupported'
            ? <p className="privacy-note">Ce navigateur ne prend pas en charge les notifications. Sur iPhone/iPad, utilisez l’application ajoutée à l’écran d’accueil.</p>
            : <button className="primary-button" disabled={pushBusy || pushStatus === 'checking' || !online} onClick={enableNotifications}>{pushBusy ? 'Activation…' : 'Activer les notifications'}</button>}
    </section>

    <section className="text-panel">
      <span className="eyebrow">Mon compte</span><h2>Ce que je souhaite recevoir</h2><p>Vous pouvez modifier ces choix à tout moment. Ils s’appliquent à tous vos appareils rattachés à ce compte.</p>
      <div className="notification-toggle-list">{visiblePreferences.map(([key, label, text]) => <label className="notification-toggle-row" key={key}><span><strong>{label}</strong><small>{text}</small></span><input type="checkbox" checked={preferences[key] !== false} disabled={loading || !online} onChange={() => togglePreference(key)} /></label>)}</div>
    </section>

    {isAdmin && <section className="text-panel notification-admin-panel">
      <span className="eyebrow">Administration</span><h2>Réglages globaux du site</h2><p>Ces interrupteurs autorisent ou suspendent les envois pour l’ensemble des utilisateurs. Les préférences personnelles restent prioritaires : un membre ayant désactivé une catégorie ne la recevra pas.</p>
      <div className="notification-stats"><span><strong>{stats.devices}</strong> appareil{stats.devices > 1 ? 's' : ''} abonné{stats.devices > 1 ? 's' : ''}</span><span><strong>{stats.users}</strong> compte{stats.users > 1 ? 's' : ''} avec préférences</span></div>
      <div className="notification-toggle-list">{ADMIN_GLOBAL.map(([key, label, text]) => <label className="notification-toggle-row" key={key}><span><strong>{label}</strong><small>{text}{key !== 'enabled' && stats[key] != null ? ` · ${stats[key]} compte${stats[key] > 1 ? 's' : ''} l’autorise${stats[key] > 1 ? 'nt' : ''}` : ''}</small></span><input type="checkbox" checked={globalSettings[key] !== false} disabled={Boolean(globalBusy) || !online} onChange={() => toggleGlobal(key)} /></label>)}</div>
    </section>}
  </div>
}
