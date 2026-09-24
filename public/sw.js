const CACHE_NAME = 'danz-shell-v25'
const PRIVATE_MEDIA_CACHE = 'danz-private-thumbs-v2'
const APP_ROOT = '/danz/'
const OFFICIAL_LOGO = '/danz/image001-1.png?v=official-image001-1-20260914'
const NOTIFICATION_ICON = '/danz/icon-192-v8.png?v=official-image001-1-20260914'
const STATIC_URLS = [
  '/danz/manifest.webmanifest?v=official-image001-1-20260914',
  OFFICIAL_LOGO,
  '/danz/favicon-v8.png?v=official-image001-1-20260914',
  '/danz/apple-touch-icon-v8.png?v=official-image001-1-20260914',
  '/danz/icon-192-v8.png?v=official-image001-1-20260914',
  '/danz/icon-512-v8.png?v=official-image001-1-20260914',
  '/danz/icon-maskable-192-v8.png?v=official-image001-1-20260914',
  '/danz/icon-maskable-512-v8.png?v=official-image001-1-20260914',
]

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  const response = await fetch(APP_ROOT, { cache: 'no-store' })
  if (!response.ok) throw new Error(`App shell unavailable (${response.status})`)
  const html = await response.clone().text()
  await cache.put(APP_ROOT, response.clone())
  const assetPaths = new Set()
  const assetPattern = /(?:src|href)=["'](\/danz\/assets\/[^"']+)["']/g
  for (const match of html.matchAll(assetPattern)) assetPaths.add(match[1])
  await Promise.all([...assetPaths].map(async (path) => {
    const asset = await fetch(path, { cache: 'no-store' })
    if (!asset.ok) throw new Error(`Asset unavailable: ${path}`)
    await cache.put(path, asset)
  }))
  await cache.addAll(STATIC_URLS)
}
self.addEventListener('install', (event) => { event.waitUntil(precacheAppShell().then(() => self.skipWaiting())) })
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith('danz-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})
const isPrivateOfflineMediaPath = (pathname) => pathname.startsWith('/danz/offline-media/') || pathname.startsWith('/danz/offline-thumb/')
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin === self.location.origin && isPrivateOfflineMediaPath(url.pathname)) {
    event.respondWith((async () => {
      const privateCache = await caches.open(PRIVATE_MEDIA_CACHE)
      const cached = await privateCache.match(event.request)
      return cached || new Response('Média hors ligne indisponible', { status: 404, headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'no-store' } })
    })())
    return
  }
  if (url.origin !== self.location.origin) return
  if (event.request.mode === 'navigate') {
    // Only the application's root HTML may replace its offline shell.
    // Standalone pages (diagnostics, test sandbox) must never poison the root cache.
    const appShellNavigation = url.pathname === APP_ROOT || url.pathname === APP_ROOT + 'index.html'
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request)
        if (fresh.ok && appShellNavigation) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put(APP_ROOT, fresh.clone())
        }
        return fresh
      } catch {
        if (!appShellNavigation) return Response.error()
        const cache = await caches.open(CACHE_NAME)
        return (await cache.match(APP_ROOT)) || Response.error()
      }
    })())
    return
  }
  if (url.pathname.startsWith('/danz/assets/')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request)
        if (fresh.ok) { const cache = await caches.open(CACHE_NAME); await cache.put(event.request, fresh.clone()) }
        return fresh
      } catch { const cache = await caches.open(CACHE_NAME); return (await cache.match(event.request)) || Response.error() }
    })())
    return
  }
  if (url.pathname.startsWith('/danz/') && (event.request.destination === 'image' || event.request.destination === 'font' || url.pathname.endsWith('.webmanifest'))) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(event.request)
      if (cached) return cached
      try { const fresh = await fetch(event.request); if (fresh.ok) await cache.put(event.request, fresh.clone()); return fresh } catch { return Response.error() }
    })())
  }
})
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() || {} } catch { data = { body: event.data?.text() || 'Nouvelle information disponible.' } }
  event.waitUntil(self.registration.showNotification(data.title || 'Amicale DANZ Antilles', { body: data.body || 'Nouvelle information disponible.', icon: NOTIFICATION_ICON, badge: NOTIFICATION_ICON, tag: data.tag || 'danz-update', data: { url: data.url || '/danz/#/' } }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/danz/#/', self.location.origin).href
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientsList) { if ('focus' in client) { if ('navigate' in client) await client.navigate(target); return client.focus() } }
    if (clients.openWindow) return clients.openWindow(target)
    return undefined
  })())
})
