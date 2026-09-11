const DB_NAME = 'danz-offline-mutations-v1'
const DB_VERSION = 1
const STORE = 'mutations'
const MAX_MUTATIONS_PER_USER = 100
const ALLOWED_TYPES = new Set(['poll_vote', 'good_deal_submission'])

const canUseIndexedDb = () => typeof window !== 'undefined' && 'indexedDB' in window
const nowIso = () => new Date().toISOString()
const clonePayload = (value) => JSON.parse(JSON.stringify(value ?? {}))

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  if (!globalThis.crypto?.getRandomValues) throw new Error('Cet appareil ne permet pas de créer un identifiant hors ligne sécurisé.')
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

let dbPromise = null

function openDb() {
  if (!canUseIndexedDb()) return Promise.reject(new Error('Le stockage hors ligne n’est pas disponible sur cet appareil.'))
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.objectStoreNames.contains(STORE)
        ? request.transaction.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: 'id' })
      if (!store.indexNames.contains('userId')) store.createIndex('userId', 'userId', { unique: false })
      if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt', { unique: false })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = null
      reject(request.error || new Error('Impossible d’ouvrir le stockage hors ligne.'))
    }
    request.onblocked = () => reject(new Error('Le stockage hors ligne est temporairement verrouillé.'))
  })
  return dbPromise
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Erreur de stockage hors ligne.'))
  })
}

async function runStore(mode, callback) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const store = tx.objectStore(STORE)
    let result
    try {
      result = callback(store)
    } catch (error) {
      tx.abort()
      reject(error)
      return
    }
    tx.oncomplete = async () => {
      try { resolve(await result) } catch (error) { reject(error) }
    }
    tx.onerror = () => reject(tx.error || new Error('Erreur de transaction hors ligne.'))
    tx.onabort = () => reject(tx.error || new Error('Transaction hors ligne annulée.'))
  })
}

function emitQueueChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('danz-offline-queue-changed'))
}

export async function listOfflineMutations(userId) {
  if (!userId || !canUseIndexedDb()) return []
  const rows = await runStore('readonly', (store) => requestAsPromise(store.index('userId').getAll(userId)))
  return (rows || []).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

export async function countOfflineMutations(userId) {
  if (!userId || !canUseIndexedDb()) return 0
  return runStore('readonly', (store) => requestAsPromise(store.index('userId').count(userId)))
}

export async function queueOfflineMutation({ userId, type, payload, dedupeKey = null }) {
  if (!userId) throw new Error('Utilisateur hors ligne introuvable.')
  if (!ALLOWED_TYPES.has(type)) throw new Error('Cette action n’est pas autorisée hors ligne.')

  const existing = await listOfflineMutations(userId)
  const id = dedupeKey ? `${userId}:${dedupeKey}` : randomId()
  if (!dedupeKey && existing.length >= MAX_MUTATIONS_PER_USER) {
    throw new Error('Trop de modifications sont déjà en attente sur cet appareil. Reconnectez-vous avant d’en ajouter.')
  }

  const previous = existing.find((item) => item.id === id)
  const record = {
    id,
    requestId: previous?.requestId || randomId(),
    userId,
    type,
    payload: clonePayload(payload),
    createdAt: previous?.createdAt || nowIso(),
    updatedAt: nowIso(),
    attempts: 0,
    status: 'pending',
    lastError: null,
  }
  await runStore('readwrite', (store) => requestAsPromise(store.put(record)))
  emitQueueChanged()
  return record
}

export async function updateOfflineMutation(id, patch) {
  if (!id || !canUseIndexedDb()) return null
  const db = await openDb()
  const existing = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(id)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
  if (!existing) return null
  const next = { ...existing, ...clonePayload(patch), updatedAt: nowIso() }
  await runStore('readwrite', (store) => requestAsPromise(store.put(next)))
  emitQueueChanged()
  return next
}

export async function deleteOfflineMutation(id) {
  if (!id || !canUseIndexedDb()) return
  await runStore('readwrite', (store) => requestAsPromise(store.delete(id)))
  emitQueueChanged()
}

export async function clearOfflineMutations(userId) {
  if (!userId || !canUseIndexedDb()) return
  const rows = await listOfflineMutations(userId)
  if (!rows.length) return
  await runStore('readwrite', (store) => Promise.all(rows.map((item) => requestAsPromise(store.delete(item.id)))))
  emitQueueChanged()
}
