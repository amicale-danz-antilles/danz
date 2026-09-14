import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { readOfflineEntry } from '../lib/offlineCache.js'
import { listOfflineMutations, queueOfflineMutation } from '../lib/offlineMutations.js'
import '../polls-bureau.css'
import '../home-polls.css'

const isOpen = (poll) => poll?.active === true && (!poll.closes_at || new Date(poll.closes_at).getTime() > Date.now())
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

function groupOptions(rows = []) {
  const grouped = {}
  for (const option of rows) {
    if (!grouped[option.poll_id]) grouped[option.poll_id] = []
    grouped[option.poll_id].push(option)
  }
  return grouped
}

function groupVotes(rows = []) {
  return Object.fromEntries(rows.map((vote) => [vote.poll_id, vote.option_id]))
}

export default function HomeOpenPolls() {
  const { user } = useAuth()
  const [polls, setPolls] = useState([])
  const [options, setOptions] = useState({})
  const [votes, setVotes] = useState({})
  const [queuedVotes, setQueuedVotes] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyPoll, setBusyPoll] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [online, setOnline] = useState(() => navigator.onLine)

  const loadCached = () => {
    const entry = readOfflineEntry(user?.id, 'polls')
    if (!entry?.data) {
      setPolls([]); setOptions({}); setVotes({})
      return false
    }
    const snapshot = entry.data
    setPolls((snapshot.polls || []).filter(isOpen).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)))
    setOptions(groupOptions(snapshot.options || []))
    setVotes(groupVotes(snapshot.votes || []))
    return true
  }

  const refreshQueue = async () => {
    if (!user?.id) return setQueuedVotes({})
    const rows = await listOfflineMutations(user.id).catch(() => [])
    const next = {}
    for (const row of rows) {
      if (row.type === 'poll_vote' && row.payload?.poll_id && Object.prototype.hasOwnProperty.call(row.payload, 'option_id')) {
        next[row.payload.poll_id] = row.payload.option_id || null
      }
    }
    setQueuedVotes(next)
  }

  const load = async () => {
    if (!user?.id) return
    setLoading(true); setError('')
    if (!navigator.onLine) {
      loadCached()
      setLoading(false)
      return
    }

    const now = new Date().toISOString()
    const { data: pollData, error: pollError } = await supabase
      .from('polls')
      .select('id,title,description,closes_at,active,created_at')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(12)

    if (pollError) {
      if (!loadCached()) setError('Impossible de charger les sondages pour le moment.')
      setLoading(false)
      return
    }

    const openPolls = (pollData || []).filter((poll) => !poll.closes_at || poll.closes_at > now)
    setPolls(openPolls)
    if (!openPolls.length) {
      setOptions({}); setVotes({}); setLoading(false)
      return
    }

    const ids = openPolls.map((poll) => poll.id)
    const [{ data: optionData, error: optionError }, { data: voteData, error: voteError }] = await Promise.all([
      supabase.from('poll_options').select('id,poll_id,label,sort_order,vote_count').in('poll_id', ids).order('sort_order'),
      supabase.from('poll_votes').select('poll_id,option_id').eq('user_id', user.id).in('poll_id', ids),
    ])

    if (optionError || voteError) {
      setError('Les sondages sont disponibles, mais certains résultats n’ont pas pu être actualisés.')
    }
    setOptions(groupOptions(optionData || []))
    setVotes(groupVotes(voteData || []))
    setLoading(false)
  }

  useEffect(() => {
    load()
    refreshQueue()
    const onOnline = () => { setOnline(true); load(); refreshQueue() }
    const onOffline = () => { setOnline(false); loadCached(); setLoading(false) }
    const onQueue = () => refreshQueue()
    const onSync = () => { load(); refreshQueue() }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('danz-offline-queue-changed', onQueue)
    window.addEventListener('danz-offline-sync-complete', onSync)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('danz-offline-queue-changed', onQueue)
      window.removeEventListener('danz-offline-sync-complete', onSync)
    }
  }, [user?.id])

  const selectedVotes = useMemo(() => ({ ...votes, ...queuedVotes }), [votes, queuedVotes])

  const vote = async (pollId, optionId) => {
    if (!user?.id) return
    const queued = hasOwn(queuedVotes, pollId)
    const previous = queued ? queuedVotes[pollId] : (votes[pollId] || null)
    const nextOptionId = previous === optionId ? null : optionId

    setBusyPoll(pollId); setError(''); setMessage('')
    try {
      if (!navigator.onLine) {
        await queueOfflineMutation({
          userId: user.id,
          type: 'poll_vote',
          dedupeKey: `poll-vote:${pollId}`,
          payload: { poll_id: pollId, option_id: nextOptionId },
        })
        setQueuedVotes((current) => ({ ...current, [pollId]: nextOptionId }))
        setMessage(nextOptionId
          ? (previous ? 'Votre nouveau choix est enregistré sur cet appareil. Il sera synchronisé au retour d’Internet.' : 'Votre choix est enregistré sur cet appareil. Il sera synchronisé au retour d’Internet.')
          : 'Le retrait de votre vote est enregistré sur cet appareil. Il sera synchronisé au retour d’Internet.')
      } else if (nextOptionId === null) {
        const { error: deleteError } = await supabase.from('poll_votes').delete().eq('poll_id', pollId).eq('user_id', user.id)
        if (deleteError) throw deleteError
        setVotes((current) => { const next = { ...current }; delete next[pollId]; return next })
        setQueuedVotes((current) => { const next = { ...current }; delete next[pollId]; return next })
        setMessage('Votre vote a bien été retiré.')
        await load()
      } else {
        const { error: voteError } = await supabase.from('poll_votes').upsert({
          poll_id: pollId,
          user_id: user.id,
          option_id: nextOptionId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'poll_id,user_id' })
        if (voteError) throw voteError
        setVotes((current) => ({ ...current, [pollId]: nextOptionId }))
        setQueuedVotes((current) => { const next = { ...current }; delete next[pollId]; return next })
        setMessage(previous ? 'Votre vote a bien été modifié.' : 'Votre vote a bien été enregistré.')
        await load()
      }
    } catch (voteError) {
      setError(voteError?.message || 'Impossible d’enregistrer ce choix.')
    } finally {
      setBusyPoll(null)
    }
  }

  if (loading && !polls.length) return <section className="home-polls-section"><div className="skeleton-card" /></section>
  if (!polls.length) return null

  return <section className="home-polls-section" aria-labelledby="home-polls-title">
    <div className="home-section-title"><div><span className="eyebrow">Votre avis compte</span><h2 id="home-polls-title">Sondages ouverts</h2></div><span className="home-polls-count">{polls.length} ouvert{polls.length > 1 ? 's' : ''}</span></div>
    {!online && <div className="offline-v2-notice compact"><strong>Hors ligne</strong><span>Votre dernier choix est conservé sur cet appareil puis synchronisé automatiquement.</span></div>}
    {error && <div className="alert error">{error}</div>}
    {message && <div className="alert success">{message}</div>}
    <div className="home-polls-list">
      {polls.map((poll) => <HomePollCard key={poll.id} poll={poll} options={options[poll.id] || []} storedVote={votes[poll.id]} selectedVote={selectedVotes[poll.id]} queuedVote={queuedVotes[poll.id]} hasQueuedVote={hasOwn(queuedVotes, poll.id)} busy={busyPoll === poll.id} onVote={vote} />)}
    </div>
  </section>
}

function HomePollCard({ poll, options, storedVote, selectedVote, queuedVote, hasQueuedVote, busy, onVote }) {
  const baseTotal = options.reduce((sum, option) => sum + Number(option.vote_count || 0), 0)
  let effectiveTotal = baseTotal
  if (hasQueuedVote && storedVote && queuedVote === null) effectiveTotal = Math.max(0, baseTotal - 1)
  else if (hasQueuedVote && !storedVote && queuedVote) effectiveTotal = baseTotal + 1

  return <article className="poll-card home-poll-card">
    <div className="poll-card-head"><div><span className="poll-status open">Vote ouvert</span><h3>{poll.title}</h3>{poll.description && <p>{poll.description}</p>}<small>{poll.closes_at ? `Clôture : ${new Date(poll.closes_at).toLocaleString('fr-FR')}` : 'Sans date de clôture'}</small>{hasQueuedVote && <span className="offline-pending-badge">⏳ Modification en attente de synchronisation</span>}</div></div>
    <div className="poll-options">
      {options.map((option) => {
        let count = Number(option.vote_count || 0)
        if (hasQueuedVote && storedVote && option.id === storedVote && queuedVote !== storedVote) count = Math.max(0, count - 1)
        if (hasQueuedVote && queuedVote && option.id === queuedVote && queuedVote !== storedVote) count += 1
        const percent = effectiveTotal ? Math.round((count / effectiveTotal) * 100) : 0
        const selected = selectedVote === option.id
        return <button key={option.id} type="button" className={`poll-option ${selected ? 'selected' : ''}`} disabled={busy} onClick={() => onVote(poll.id, option.id)}>
          <div className="poll-option-top"><span>{selected ? '✓ ' : ''}{option.label}</span><strong>{count} voix · {percent}%</strong></div>
          <span className="poll-result-bar"><span style={{ width: `${percent}%` }} /></span>
        </button>
      })}
    </div>
    <small className="poll-total">{effectiveTotal} vote{effectiveTotal > 1 ? 's' : ''} · Touchez une autre réponse pour modifier votre vote, ou touchez à nouveau votre réponse cochée pour retirer votre vote.</small>
  </article>
}
