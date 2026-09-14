import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { readOfflineEntry } from '../../lib/offlineCache.js'
import { listOfflineMutations, queueOfflineMutation } from '../../lib/offlineMutations.js'
import { PageTitle } from '../Actualites.jsx'
import '../../polls-bureau.css'
import '../../offline-v2.css'

const isOpen = (poll) => poll.active === true && (!poll.closes_at || new Date(poll.closes_at).getTime() > Date.now())
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

export default function OfflineSondages() {
  const { user } = useAuth()
  const entry = readOfflineEntry(user?.id, 'polls')
  const snapshot = entry?.data || { polls: [], options: [], votes: [] }
  const [queuedVotes, setQueuedVotes] = useState({})
  const [busyPoll, setBusyPoll] = useState(null)
  const [error, setError] = useState('')

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

  useEffect(() => {
    refreshQueue()
    const onQueue = () => refreshQueue()
    window.addEventListener('danz-offline-queue-changed', onQueue)
    return () => window.removeEventListener('danz-offline-queue-changed', onQueue)
  }, [user?.id])

  const optionsByPoll = useMemo(() => {
    const result = {}
    for (const option of snapshot.options || []) {
      if (!result[option.poll_id]) result[option.poll_id] = []
      result[option.poll_id].push(option)
    }
    return result
  }, [snapshot.options])

  const storedVotes = useMemo(
    () => Object.fromEntries((snapshot.votes || []).map((vote) => [vote.poll_id, vote.option_id])),
    [snapshot.votes],
  )
  const active = (snapshot.polls || []).filter(isOpen)
  const closed = (snapshot.polls || []).filter((poll) => !isOpen(poll))

  const vote = async (pollId, optionId) => {
    if (!user?.id) return
    const queued = hasOwn(queuedVotes, pollId)
    const previous = queued ? queuedVotes[pollId] : (storedVotes[pollId] || null)
    const nextOptionId = previous === optionId ? null : optionId

    setBusyPoll(pollId)
    setError('')
    try {
      await queueOfflineMutation({
        userId: user.id,
        type: 'poll_vote',
        dedupeKey: `poll-vote:${pollId}`,
        payload: { poll_id: pollId, option_id: nextOptionId },
      })
      setQueuedVotes((current) => ({ ...current, [pollId]: nextOptionId }))
    } catch (queueError) {
      setError(queueError.message || 'Impossible d’enregistrer cette modification hors ligne.')
    } finally {
      setBusyPoll(null)
    }
  }

  return <>
    <PageTitle eyebrow="Mode hors ligne" title="Sondages" text="Vous pouvez consulter la dernière copie, modifier votre réponse ou retirer votre vote hors connexion. La dernière action sera synchronisée automatiquement au retour d’Internet." />
    <OfflineNotice savedAt={entry?.savedAt} pendingCount={Object.keys(queuedVotes).length} />
    {error && <div className="alert error offline-action-alert">{error}</div>}
    {!entry ? <div className="empty-state">Aucune copie des sondages n’a encore été enregistrée sur cet appareil. Ouvrez le site une fois avec Internet pour préparer le mode hors ligne.</div> : <>
      <PollGroup title="Sondages ouverts" polls={active} optionsByPoll={optionsByPoll} storedVotes={storedVotes} queuedVotes={queuedVotes} busyPoll={busyPoll} onVote={vote} />
      {closed.length > 0 && <PollGroup title="Sondages clôturés" polls={closed} optionsByPoll={optionsByPoll} storedVotes={storedVotes} queuedVotes={queuedVotes} busyPoll={busyPoll} onVote={vote} />}
    </>}
  </>
}

function OfflineNotice({ savedAt, pendingCount }) {
  return <div className="offline-v2-notice"><strong>Mode hors ligne</strong><span>{savedAt ? `Copie synchronisée le ${new Date(savedAt).toLocaleString('fr-FR')}. ` : ''}{pendingCount ? `${pendingCount} modification${pendingCount > 1 ? 's' : ''} de vote en attente de synchronisation. ` : ''}Les résultats affichés peuvent avoir évolué sur le serveur.</span></div>
}

function PollGroup({ title, polls, optionsByPoll, storedVotes, queuedVotes, busyPoll, onVote }) {
  return <section className="poll-section"><div className="section-heading"><div><span className="eyebrow">Copie locale</span><h2>{title}</h2></div></div><div className="poll-list">{polls.length ? polls.map((poll) => <OfflinePoll key={poll.id} poll={poll} options={optionsByPoll[poll.id] || []} storedVote={storedVotes[poll.id]} queuedVote={queuedVotes[poll.id]} hasQueuedVote={hasOwn(queuedVotes, poll.id)} busy={busyPoll === poll.id} onVote={onVote} />) : <div className="empty-state">Aucun sondage dans cette rubrique.</div>}</div></section>
}

function OfflinePoll({ poll, options, storedVote, queuedVote, hasQueuedVote, busy, onVote }) {
  const open = isOpen(poll)
  const selectedVote = hasQueuedVote ? queuedVote : storedVote
  const baseTotal = options.reduce((sum, option) => sum + Number(option.vote_count || 0), 0)
  let effectiveTotal = baseTotal
  if (hasQueuedVote && storedVote && queuedVote === null) effectiveTotal = Math.max(0, baseTotal - 1)
  else if (hasQueuedVote && !storedVote && queuedVote) effectiveTotal = baseTotal + 1

  return <article className="poll-card offline-readonly-card"><div className="poll-card-head"><div><span className={`poll-status ${open ? 'open' : 'closed'}`}>{open ? 'Vote ouvert' : 'Vote clôturé'}</span><h3>{poll.title}</h3>{poll.description && <p>{poll.description}</p>}<small>{poll.closes_at ? `Clôture : ${new Date(poll.closes_at).toLocaleString('fr-FR')}` : 'Sans date de clôture'}</small>{hasQueuedVote && <span className="offline-pending-badge">⏳ Modification enregistrée sur cet appareil</span>}</div></div><div className="poll-options">{options.map((option) => {
    let count = Number(option.vote_count || 0)
    if (hasQueuedVote && storedVote && option.id === storedVote && queuedVote !== storedVote) count = Math.max(0, count - 1)
    if (hasQueuedVote && queuedVote && option.id === queuedVote && queuedVote !== storedVote) count += 1
    const percent = effectiveTotal ? Math.round((count / effectiveTotal) * 100) : 0
    const selected = selectedVote === option.id
    return <button className={`poll-option offline-poll-option ${selected ? 'selected' : ''}`} key={option.id} type="button" disabled={!open || busy} onClick={() => onVote(poll.id, option.id)}><div className="poll-option-top"><span>{selected ? '✓ ' : ''}{option.label}</span><strong>{count} voix · {percent}%</strong></div><span className="poll-result-bar"><span style={{ width: `${percent}%` }} /></span></button>
  })}</div><small className="poll-total">{effectiveTotal} vote{effectiveTotal > 1 ? 's' : ''}{open ? ' · Touchez une autre réponse pour modifier votre vote, ou votre réponse cochée pour le retirer.' : ' · Ce sondage est clôturé.'}</small></article>
}
