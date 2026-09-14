import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import '../home-polls.css'

const VAPID_PUBLIC_KEY = 'BB0cZFeJlrnRo6sF9JN3pNwNhpkgaZJdxlKj0nO6XZ53r01WLCcPwkwPP42uUCFqsp7yLY50Le1X_dBw2RFcOUQ'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

function subscriptionPayload(subscription, userId) {
  const json = subscription.toJSON()
  return { user_id: userId, endpoint: subscription.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }
}

export default function NotificationOnboarding({ userId }) {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const storageKey = userId ? `danz-notification-onboarding:${userId}` : ''

  useEffect(() => {
    if (!userId || !navigator.onLine || !storageKey) return undefined
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return undefined
    if (window.localStorage.getItem(storageKey)) return undefined

    let cancelled = false
    const check = async () => {
      try {
        if (Notification.permission === 'denied') {
          window.localStorage.setItem(storageKey, 'denied')
          return
        }
        const registration = await navigator.serviceWorker.getRegistration('/danz/')
        const subscription = await registration?.pushManager.getSubscription()
        if (subscription && Notification.permission === 'granted') {
          await supabase.from('push_subscriptions').upsert(subscriptionPayload(subscription, userId), { onConflict: 'endpoint' })
          window.localStorage.setItem(storageKey, 'already-enabled')
          return
        }
        if (!cancelled) window.setTimeout(() => { if (!cancelled) setVisible(true) }, 650)
      } catch {
        if (!cancelled) window.setTimeout(() => { if (!cancelled) setVisible(true) }, 650)
      }
    }
    check()
    return () => { cancelled = true }
  }, [userId, storageKey])

  const close = (value = 'later') => {
    if (storageKey) window.localStorage.setItem(storageKey, value)
    setVisible(false)
  }

  const enable = async () => {
    setBusy(true); setError('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        if (permission === 'denied') close('denied')
        else setError('L’autorisation n’a pas été accordée. Vous pourrez réessayer plus tard depuis la rubrique Notifications.')
        return
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

      let { error: saveError } = await supabase.from('push_subscriptions').upsert(subscriptionPayload(subscription, userId), { onConflict: 'endpoint' })
      if (saveError) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint).catch(() => {})
        const retry = await supabase.from('push_subscriptions').upsert(subscriptionPayload(subscription, userId), { onConflict: 'endpoint' })
        saveError = retry.error
      }
      if (saveError) throw saveError
      close('enabled')
    } catch (activationError) {
      setError(activationError?.message || 'Impossible d’activer les notifications sur cet appareil.')
    } finally {
      setBusy(false)
    }
  }

  if (!visible) return null

  return <div className="notification-onboarding-backdrop" role="presentation">
    <section className="notification-onboarding" role="dialog" aria-modal="true" aria-labelledby="notification-onboarding-title">
      <span className="notification-onboarding-mark" aria-hidden="true">🔔</span>
      <div><span className="eyebrow">Première connexion</span><h2 id="notification-onboarding-title">Souhaitez-vous recevoir les notifications ?</h2></div>
      <p>Recevez les nouvelles publications, les sondages et les albums directement sur cet appareil. Vous pourrez modifier vos choix à tout moment dans la rubrique Notifications.</p>
      {error && <div className="alert error">{error}</div>}
      <div className="notification-onboarding-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={enable}>{busy ? 'Activation…' : 'Activer les notifications'}</button>
        <button type="button" className="ghost-button" disabled={busy} onClick={() => close('later')}>Plus tard</button>
      </div>
      <small>L’autorisation système ne sera demandée qu’après avoir touché « Activer les notifications ».</small>
    </section>
  </div>
}
