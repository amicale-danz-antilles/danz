self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_) {
    data = { title: 'Amicale DANZ Antilles', body: event.data?.text() || 'Nouvelle information disponible.' }
  }

  const title = data.title || 'Amicale DANZ Antilles'
  const options = {
    body: data.body || 'Nouvelle information disponible.',
    icon: '/danz/app-icon.png',
    badge: '/danz/app-icon.png',
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
      if ('focus' in client) {
        await client.navigate(target)
        return client.focus()
      }
    }
    return clients.openWindow(target)
  })())
})
