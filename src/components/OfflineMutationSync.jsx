import { useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import useOnlineStatus from '../hooks/useOnlineStatus.js'
import {
  deleteOfflineMutation,
  listOfflineMutations,
  updateOfflineMutation,
} from '../lib/offlineMutations.js'

const NETWORK_ERROR = /fetch|network|failed to fetch|load failed|networkerror|timeout/i

function safeError(error) {
  const message = String(error?.message || error || 'Erreur de synchronisation')
  return message.slice(0, 280)
}

async function syncRecord(record, userId) {
  if (record.type === 'poll_vote') {
    const payload = {
      poll_id: record.payload?.poll_id,
      option_id: record.payload?.option_id,
      user_id: userId,
      updated_at: new Date().toISOString(),
    }
    if (!payload.poll_id || !payload.option_id) return { error: new Error('Vote hors ligne incomplet.') }
    return supabase.from('poll_votes').upsert(payload, { onConflict: 'poll_id,user_id' })
  }

  if (record.type === 'good_deal_submission') {
    const payload = {
      ...record.payload,
      id: record.requestId,
      submitted_by: userId,
      status: 'pending',
    }
    const result = await supabase.from('good_deal_submissions').insert(payload)
    // Même UUID côté client et côté serveur : une réponse perdue après insertion
    // ne peut pas créer de doublon lors de la tentative suivante.
    if (result.error?.code === '23505') return { data: null, error: null }
    return result
  }

  return { error: new Error('Type de modification hors ligne inconnu.') }
}

export default function OfflineMutationSync({ userId }) {
  const online = useOnlineStatus()

  useEffect(() => {
    if (!userId || !online || !supabase) return undefined
    let cancelled = false

    const sync = async () => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (cancelled || sessionError || sessionData?.session?.user?.id !== userId) return

      const records = await listOfflineMutations(userId).catch(() => [])
      let synced = 0
      let failed = 0

      for (const record of records) {
        if (cancelled) return
        try {
          const result = await syncRecord(record, userId)
          if (!result?.error) {
            await deleteOfflineMutation(record.id)
            synced += 1
            continue
          }

          const message = safeError(result.error)
          if (NETWORK_ERROR.test(message)) break
          const attempts = Number(record.attempts || 0) + 1
          await updateOfflineMutation(record.id, {
            attempts,
            status: attempts >= 3 ? 'error' : 'pending',
            lastError: message,
          })
          failed += 1
        } catch (error) {
          const message = safeError(error)
          if (NETWORK_ERROR.test(message)) break
          const attempts = Number(record.attempts || 0) + 1
          await updateOfflineMutation(record.id, {
            attempts,
            status: attempts >= 3 ? 'error' : 'pending',
            lastError: message,
          }).catch(() => {})
          failed += 1
        }
      }

      if (!cancelled && (synced || failed)) {
        window.dispatchEvent(new CustomEvent('danz-offline-sync-complete', {
          detail: { synced, failed },
        }))
      }
    }

    const timer = window.setTimeout(sync, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [userId, online])

  return null
}
