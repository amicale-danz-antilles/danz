const CACHE_NAME = 'danz-shell-v10'
const THUMB_CACHE = 'danz-private-thumbs-v2'
const APP_ROOT = '/danz/'
const STATIC_URLS = [
  '/danz/manifest.webmanifest',
  '/danz/apple-touch-icon-v4.png',
  '/danz/icon-192-v4.png',
  '/danz/icon-512-v4.png',
  '/danz/Insigne%20CND%20-%20ANTILLES.png',
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

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith('danz-shell-') && name !== CACHE_NAME).map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (!url.pathname.startsWith('/danz/')) return

  if (url.pathname.startsWith('/danz/offline-thumb/')) {
    event.respondWith(caches.open(THUMB_CACHE).then((cache) => cache.match(request)).then((hit) => hit || new Response('', { status: 404 })))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' })
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put(APP_ROOT, response.clone())
        }
        return response
      } catch (_) {
        return (await caches.match(APP_ROOT)) || Response.error()
      }
    })())
    return
  }

  const isCode = request.destination === 'script' || request.destination === 'style' || url.pathname.startsWith('/danz/assets/')
  if (isCode) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' })
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put(request, response.clone())
        }
        return response
      } catch (_) {
        return (await caches.match(request)) || Response.error()
      }
    })())
    return
  }

  const cacheable = ['font', 'image', 'manifest'].includes(request.destination)
  if (!cacheable) return

  event.respondWith((async () => {
    const cached = await caches.match(request)
    if (cached) return cached
    try {
      const response = await fetch(request)
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME)
        await cache.put(request, response.clone())
      }
      return response
    } catch (_) {
      return Response.error()
    }
  })())
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (_) { data = { title: 'Amicale DANZ Antilles', body: event.data?.text() || 'Nouvelle information disponible.' } }
  const title = data.title || 'Amicale DANZ Antilles'
  const options = {
    body: data.body || 'Nouvelle information disponible.',
    icon: '/danz/icon-192-v4.png',
    badge: '/danz/icon-192-v4.png',
    tag: data.type ? `danz-${data.type}` : 'danz-notification',
    data: { url: data.url || '/danz/#/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/danz/#/', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client) { await client.navigate(target); return client.focus() }
    }
    return clients.openWindow(target)
  })())
})
