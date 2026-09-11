import { useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { readOfflineData, saveOfflineData } from '../lib/offlineCache.js'
import { resolvePrivateMediaBatch } from '../lib/mediaStorage.js'
import useOnlineStatus from '../hooks/useOnlineStatus.js'

const PRIVATE_MEDIA_CACHE = 'danz-private-thumbs-v2'
const MAX_OFFLINE_MEDIA = 1.5 * 1024 * 1024
const SYNC_INTERVAL_MS = 15 * 60 * 1000
const MIN_REFRESH_GAP_MS = 5 * 60 * 1000
const EVENT_HISTORY_DAYS = 120

const mediaVersion = (value) => String(value || 'v1').replace(/[^a-zA-Z0-9]/g, '').slice(-36) || 'v1'
const mediaPath = (userId, scope, id, version) => `/danz/offline-media/${encodeURIComponent(userId)}/${encodeURIComponent(scope)}/${encodeURIComponent(id)}-${mediaVersion(version)}`

async function findExistingMedia(userId, scope, id) {
  if (!('caches' in window)) return null
  try {
    const cache = await caches.open(PRIVATE_MEDIA_CACHE)
    const prefix = `/danz/offline-media/${encodeURIComponent(userId)}/${encodeURIComponent(scope)}/${encodeURIComponent(id)}-`
    const requests = await cache.keys()
    const existing = requests.find((request) => new URL(request.url).pathname.startsWith(prefix))
    return existing ? new URL(existing.url).pathname : null
  } catch { return null }
}

async function cachePrivateMedia(userId, scope, item, sourceUrl, version) {
  if (!('caches' in window)) return null
  const existing = await findExistingMedia(userId, scope, item.id)
  const declaredSize = Number(item.file_size || 0)
  if (!sourceUrl || (declaredSize && declaredSize > MAX_OFFLINE_MEDIA)) return existing
  try {
    const response = await fetch(sourceUrl, { cache: 'no-store' })
    if (!response.ok) return existing
    const blob = await response.blob()
    if (blob.size > MAX_OFFLINE_MEDIA) return existing
    const path = mediaPath(userId, scope, item.id, version)
    const cache = await caches.open(PRIVATE_MEDIA_CACHE)
    const headers = new Headers({
      'Content-Type': blob.type || item.mime_type || 'image/jpeg',
      'Cache-Control': 'private, max-age=1814400',
      'X-Danz-Cached-At': new Date().toISOString(),
    })
    await cache.put(new Request(new URL(path, window.location.origin)), new Response(blob, { headers }))
    return path
  } catch { return existing }
}

async function prunePrivateMedia(userId, keepPaths) {
  if (!('caches' in window)) return
  try {
    const cache = await caches.open(PRIVATE_MEDIA_CACHE)
    const requests = await cache.keys()
    const marker = `/danz/offline-media/${encodeURIComponent(userId)}/`
    const legacyMarker = `/danz/offline-thumb/${encodeURIComponent(userId)}/`
    await Promise.all(requests.filter((request) => {
      const path = new URL(request.url).pathname
      if (path.startsWith(legacyMarker)) return true
      return path.startsWith(marker) && !keepPaths.has(path)
    }).map((request) => cache.delete(request)))
  } catch {}
}

const offlineAlbumMeta = (album) => album ? {
  id: album.id,
  event_id: album.event_id,
  item_count: album.item_count,
  transfer_expires_at: album.transfer_expires_at,
  download_note: album.download_note,
} : null

export default function OfflineDataSync({ userId }) {
  const online = useOnlineStatus()

  useEffect(() => {
    if (!userId || !online || !supabase) return undefined
    let cancelled = false
    let running = false
    let lastRunAt = 0

    const syncOnce = async (force = false) => {
      if (cancelled || running || !navigator.onLine) return
      if (!force && Date.now() - lastRunAt < MIN_REFRESH_GAP_MS) return
      running = true
      lastRunAt = Date.now()
      const keepMedia = new Set()
      try {
        const since = new Date(Date.now() - EVENT_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString()
        const [dealsResult, pollsResult, albumsResult, eventsResult, newsResult, bureauResult] = await Promise.all([
          supabase.from('good_deals').select('id,title,category,description,offer_text,address,municipality,latitude,longitude,map_verified,phone,email,website_url,valid_until,audience,created_at').order('created_at', { ascending: false }).limit(80),
          supabase.from('polls').select('id,title,description,closes_at,active,created_at').order('created_at', { ascending: false }).limit(20),
          supabase.from('event_albums').select('id,event_id,storage_provider,storage_path,image_url,mime_type,file_size,transfer_expires_at,item_count,download_note,updated_at,event:events(id,title,description,location,starts_at,ends_at,audience)').order('updated_at', { ascending: false }).limit(24),
          supabase.from('events').select('id,title,description,location,starts_at,ends_at,audience,publish_at').gte('starts_at', since).order('starts_at', { ascending: true }).limit(60),
          supabase.from('news').select('id,title,summary,content,audience,publish_at,published_at,created_at').eq('published', true).order('publish_at', { ascending: false }).limit(8),
          supabase.from('bureau_members').select('role_key,role_label,full_name,sort_order').order('sort_order'),
        ])
        if (cancelled) return

        const deals = dealsResult.data || []
        if (!dealsResult.error) saveOfflineData(userId, 'good-deals', deals)

        const polls = pollsResult.data || []
        if (!pollsResult.error && polls.length) {
          const ids = polls.map((item) => item.id)
          const [optionsResult, votesResult] = await Promise.all([
            supabase.from('poll_options').select('id,poll_id,label,sort_order,vote_count').in('poll_id', ids).order('sort_order'),
            supabase.from('poll_votes').select('poll_id,option_id').eq('user_id', userId),
          ])
          if (!optionsResult.error && !votesResult.error) {
            saveOfflineData(userId, 'polls', { polls, options: optionsResult.data || [], votes: votesResult.data || [] })
          }
        } else if (!pollsResult.error) {
          saveOfflineData(userId, 'polls', { polls: [], options: [], votes: [] })
        }

        const albums = albumsResult.data || []
        const albumUrls = !albumsResult.error ? await resolvePrivateMediaBatch(albums, { entity: 'album', fallbackBucket: 'gallery' }) : new Map()
        const offlineAlbums = []
        const albumByEvent = new Map()
        if (!albumsResult.error) {
          for (const album of albums) {
            if (cancelled) return
            const event = album.event
            if (!event) continue
            const sourceUrl = albumUrls.get(album.id) || album.image_url || null
            const offlineThumb = await cachePrivateMedia(userId, 'album', album, sourceUrl, album.updated_at || album.file_size)
            if (offlineThumb) keepMedia.add(offlineThumb)
            const row = {
              id: album.id,
              event_id: album.event_id,
              item_count: album.item_count,
              transfer_expires_at: album.transfer_expires_at,
              download_note: album.download_note,
              updated_at: album.updated_at,
              event,
              offline_thumb: offlineThumb,
            }
            offlineAlbums.push(row)
            albumByEvent.set(album.event_id, row)
          }
          saveOfflineData(userId, 'albums', offlineAlbums)
        }

        const events = eventsResult.data || []
        const now = Date.now()
        const recentPast = events.filter((event) => new Date(event.starts_at).getTime() < now).slice(-8)
        const upcoming = events.filter((event) => new Date(event.starts_at).getTime() >= now).slice(0, 16)
        const mediaEventIds = [...new Set([...recentPast, ...upcoming].map((event) => event.id))]
        const news = newsResult.data || []
        const [eventAssetsResult, newsAssetsResult] = await Promise.all([
          !eventsResult.error && mediaEventIds.length
            ? supabase.from('content_attachments').select('id,event_id,file_name,storage_provider,storage_path,mime_type,file_size,is_cover').in('event_id', mediaEventIds).eq('is_cover', true)
            : Promise.resolve({ data: [], error: null }),
          !newsResult.error && news.length
            ? supabase.from('content_attachments').select('id,news_id,file_name,storage_provider,storage_path,mime_type,file_size,is_cover').in('news_id', news.map((item) => item.id))
            : Promise.resolve({ data: [], error: null }),
        ])

        const eventAssets = eventAssetsResult.data || []
        const newsAssets = newsAssetsResult.data || []
        const newsCoverAssets = newsAssets.filter((asset) => asset.is_cover)
        const [eventAssetUrls, newsCoverUrls] = await Promise.all([
          eventAssetsResult.error ? Promise.resolve(new Map()) : resolvePrivateMediaBatch(eventAssets, { entity: 'attachment', fallbackBucket: 'content' }),
          newsAssetsResult.error ? Promise.resolve(new Map()) : resolvePrivateMediaBatch(newsCoverAssets, { entity: 'attachment', fallbackBucket: 'content' }),
        ])

        const eventAssetByEvent = new Map(eventAssets.map((asset) => [asset.event_id, asset]))
        const agendaAlbums = {}
        const agendaCovers = {}
        for (const event of events) {
          const album = albumByEvent.get(event.id)
          if (album) agendaAlbums[event.id] = offlineAlbumMeta(album)
          const explicit = eventAssetByEvent.get(event.id)
          let cover = album?.offline_thumb || null
          if (explicit) {
            const sourceUrl = eventAssetUrls.get(explicit.id) || null
            const cached = await cachePrivateMedia(userId, 'event', explicit, sourceUrl, explicit.id)
            if (cached) { keepMedia.add(cached); cover = cached }
          }
          if (cover) agendaCovers[event.id] = cover
        }
        if (!eventsResult.error) saveOfflineData(userId, 'agenda', { items: events, albums: agendaAlbums, covers: agendaCovers })

        const dashboardNews = []
        if (!newsResult.error) {
          for (const item of news) {
            const assets = newsAssets.filter((asset) => asset.news_id === item.id)
            const coverAsset = assets.find((asset) => asset.is_cover)
            let cover = null
            if (coverAsset) {
              cover = await cachePrivateMedia(userId, 'news', coverAsset, newsCoverUrls.get(coverAsset.id) || null, coverAsset.id)
              if (cover) keepMedia.add(cover)
            }
            dashboardNews.push({ ...item, cover, assets: assets.map((asset) => ({ id: asset.id, file_name: asset.file_name, is_cover: asset.is_cover, mime_type: asset.mime_type, file_size: asset.file_size })) })
          }
        }

        if (!newsResult.error && !eventsResult.error && !bureauResult.error) {
          const dashboardEvents = events.map((event) => ({
            ...event,
            cover: agendaCovers[event.id] || null,
            album: offlineAlbumMeta(albumByEvent.get(event.id)),
          }))
          saveOfflineData(userId, 'dashboard', { news: dashboardNews, events: dashboardEvents, bureau: bureauResult.data || [] })
        }

        const mediaSyncComplete = !albumsResult.error && !eventsResult.error && !newsResult.error && !eventAssetsResult.error && !newsAssetsResult.error
        if (mediaSyncComplete) await prunePrivateMedia(userId, keepMedia)

        saveOfflineData(userId, 'offline-sync', {
          syncedAt: new Date().toISOString(),
          retentionDays: 21,
          goodDeals: dealsResult.error ? null : deals.length,
          polls: pollsResult.error ? null : polls.length,
          news: newsResult.error ? null : news.length,
          events: eventsResult.error ? null : events.length,
          albums: albumsResult.error ? null : offlineAlbums.length,
          cachedMedia: keepMedia.size,
        })
      } catch {}
      finally { running = false }
    }

    const timer = window.setTimeout(() => syncOnce(true), 700)
    const interval = window.setInterval(() => syncOnce(true), SYNC_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') syncOnce(false) }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.clearInterval(interval)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, online])
  return null
}
