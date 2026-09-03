import { supabase } from './supabase.js'

const FALLBACK_LIMIT = 45 * 1024 * 1024

const safeName = (name = 'fichier') => name
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/-+/g, '-')
  .toLowerCase()

export async function getR2Status() {
  const { data, error } = await supabase.functions.invoke('r2-media', { body: { action: 'status' } })
  if (error) return false
  return data?.configured === true
}

export async function uploadPrivateMedia(file, { scope, parentId, fallbackBucket }) {
  const { data, error } = await supabase.functions.invoke('r2-media', {
    body: {
      action: 'upload',
      scope,
      parentId,
      fileName: file.name,
      fileSize: file.size,
    },
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

  if (file.size > FALLBACK_LIMIT) {
    throw new Error('Cloudflare R2 n’est pas encore raccordé. Tant qu’il ne l’est pas, les fichiers de secours Supabase sont limités à 45 Mo.')
  }

  const random = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const path = `${scope}/${parentId || 'general'}/${Date.now()}-${random}-${safeName(file.name)}`
  const { error: uploadError } = await supabase.storage.from(fallbackBucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  })
  if (uploadError) throw uploadError
  return { storage_provider: 'supabase', storage_path: path }
}

export async function resolvePrivateMedia(item, { entity, fallbackBucket }) {
  if (!item?.storage_path) return item?.image_url || null
  if (item.storage_provider === 'r2') {
    const { data, error } = await supabase.functions.invoke('r2-media', {
      body: { action: 'view', entity, id: item.id },
    })
    if (error || !data?.url) return null
    return data.url
  }
  const { data } = await supabase.storage.from(fallbackBucket).createSignedUrl(item.storage_path, 3600)
  return data?.signedUrl || null
}

export async function removePrivateMedia(item, { fallbackBucket }) {
  if (!item?.storage_path) return
  if (item.storage_provider === 'supabase') {
    await supabase.storage.from(fallbackBucket).remove([item.storage_path])
  }
  // La suppression physique R2 sera ajoutée dès que le bucket Cloudflare est raccordé.
  // La suppression de la ligne de base suffit à rendre le média inaccessible depuis l’application.
}
