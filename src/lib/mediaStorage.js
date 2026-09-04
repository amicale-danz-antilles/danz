import { supabase } from './supabase.js'

const FALLBACK_LIMIT = 45 * 1024 * 1024
const URL_CACHE_MS = 45 * 60 * 1000
const mediaUrlCache = new Map()

const safeName = (name = 'fichier') => name
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/-+/g, '-')
  .toLowerCase()

const cacheKey = (item, entity) => `${entity}:${item.id || item.storage_path}:${item.storage_path}`
const getCached = (item, entity) => {
  const cached = mediaUrlCache.get(cacheKey(item, entity))
  if (!cached || cached.expiresAt < Date.now()) return null
  return cached.url
}
const setCached = (item, entity, url) => {
  if (url) mediaUrlCache.set(cacheKey(item, entity), { url, expiresAt: Date.now() + URL_CACHE_MS })
}

export async function getR2Status() {
  const { data, error } = await supabase.functions.invoke('r2-media', { body: { action: 'status' } })
  if (error) return false
  return data?.configured === true
}

export async function optimizeImageFile(file, { maxDimension = 1920, quality = 0.82 } = {}) {
  if (!file?.type?.startsWith('image/') || file.type === 'image/gif') return file
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch (_) {
    return file
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    if (longest <= maxDimension && file.size <= 1.5 * 1024 * 1024) return file
    const scale = Math.min(1, maxDimension / longest)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { alpha: false })
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
    if (!blob || blob.size >= file.size) return file
    const base = (file.name || 'photo').replace(/\.[^.]+$/, '')
    return new File([blob], `${base}.webp`, { type: 'image/webp', lastModified: file.lastModified || Date.now() })
  } finally {
    bitmap.close?.()
  }
}

export async function uploadPrivateMedia(file, { scope, parentId, fallbackBucket }) {
  const { data, error } = await supabase.functions.invoke('r2-media', {
    body: { action: 'upload', scope, parentId, fileName: file.name, fileSize: file.size },
  })

  if (!error && data?.url && data?.key) {
    const response = await fetch(data.url, {
      method: 'PUT',
      body: file,
      headers: file.type ? { 'Content-Type': file.type } : undefined,
    })
    if (!response.ok) throw new Error(`Cloudflare R2 a refusé l’envoi (${response.status}).`)
    return { storage_provider: 'r2', storage_path: data.key }
  }

  const code = data?.code || error?.context?.body?.code
  if (code !== 'R2_NOT_CONFIGURED' && !String(error?.message || '').includes('non-2xx')) {
    throw new Error(data?.error || error?.message || 'Impossible de préparer le stockage du fichier.')
  }

  if (file.size > FALLBACK_LIMIT) throw new Error('Cloudflare R2 n’est pas encore raccordé. Tant qu’il ne l’est pas, les fichiers de secours Supabase sont limités à 45 Mo.')

  const random = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const path = `${scope}/${parentId || 'general'}/${Date.now()}-${random}-${safeName(file.name)}`
  const { error: uploadError } = await supabase.storage.from(fallbackBucket).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type || undefined,
  })
  if (uploadError) throw uploadError
  return { storage_provider: 'supabase', storage_path: path }
}

export async function resolvePrivateMediaBatch(items, { entity, fallbackBucket }) {
  const list = (items || []).filter(item => item?.storage_path || item?.image_url)
  const urls = new Map()
  const unresolvedR2 = []
  const unresolvedSupabase = []

  for (const item of list) {
    if (!item.storage_path && item.image_url) {
      urls.set(item.id, item.image_url)
      continue
    }
    const cached = getCached(item, entity)
    if (cached) {
      urls.set(item.id, cached)
      continue
    }
    if (item.storage_provider === 'r2') unresolvedR2.push(item)
    else unresolvedSupabase.push(item)
  }

  if (unresolvedR2.length) {
    const { data, error } = await supabase.functions.invoke('r2-media', {
      body: { action: 'batch-view', entity, ids: unresolvedR2.map(item => item.id) },
    })
    if (!error) {
      for (const item of unresolvedR2) {
        const url = data?.urls?.[item.id]
        if (url) {
          urls.set(item.id, url)
          setCached(item, entity, url)
        }
      }
    }
  }

  if (unresolvedSupabase.length) {
    const paths = unresolvedSupabase.map(item => item.storage_path)
    const { data, error } = await supabase.storage.from(fallbackBucket).createSignedUrls(paths, 3600)
    if (!error) {
      ;(data || []).forEach((entry, index) => {
        const item = unresolvedSupabase[index]
        const url = entry?.signedUrl || null
        if (item && url) {
          urls.set(item.id, url)
          setCached(item, entity, url)
        }
      })
    }
  }

  return urls
}

export async function resolvePrivateMedia(item, options) {
  if (!item) return null
  const urls = await resolvePrivateMediaBatch([item], options)
  return urls.get(item.id) || item.image_url || null
}

export async function removePrivateMedia(item, { entity, fallbackBucket } = {}) {
  if (!item?.storage_path) return
  mediaUrlCache.delete(cacheKey(item, entity || 'media'))
  if (item.storage_provider === 'r2') {
    if (entity && item.id) {
      await supabase.functions.invoke('r2-media', { body: { action: 'delete', entity, id: item.id } })
    } else {
      await supabase.functions.invoke('r2-media', { body: { action: 'delete-key', key: item.storage_path } })
    }
    return
  }
  await supabase.storage.from(fallbackBucket).remove([item.storage_path])
}
