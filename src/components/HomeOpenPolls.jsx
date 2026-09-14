import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { readOfflineEntry } from '../lib/offlineCache.js'
import { listOfflineMutations, queueOfflineMutation } from '../lib/offlineMutations.js'
import QuestionnaireCard from './QuestionnaireCard.jsx'
import '../polls-bureau.css'
import '../home-polls.css'
import '../questionnaires.css'

const isOpen = (poll) => poll?.published !== false && poll?.active === true && (!poll.closes_at || new Date(poll.closes_at).getTime() > Date.now())
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const sortPolls = (rows = []) => [...rows].sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || new Date(b.created_at) - new Date(a.created_at))

function groupByPoll(rows = []) {
  const grouped = {}
  for (const row of rows) {
    if (!grouped[row.poll_id]) grouped[row.poll_id] = []
    grouped[row.poll_id].push(row)
  }
  return grouped
}

function groupOptions(rows = []) {
  const grouped = groupByPoll(rows)
  for (const pollId of Object.keys(grouped)) grouped[pollId].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
  return grouped
}

function groupVotes(rows = []) {
  return Object.fromEntries(rows.map((vote) => [vote.poll_id, vote.option_id]))
}

async function attachLinkedPublications(polls) {
  const newsIds = [...new Set(polls.map((poll) => poll.linked_news_id).filter(Boolean))]
  const eventIds = [...new Set(polls.map((poll) => poll.linked_event_id).filter(Boolean))]
  const [newsResult, eventResult] = await Promise.all([
    newsIds.length ? supabase.from('news').select('id,title,publish_at,published_at').in('id', newsIds) : Promise.resolve({ data: [], error: null }),
    eventIds.length ? supabase.from('events').select('id,title,starts_at,ends_at,location').in('id', eventIds) : Promise.resolve({ data: [], error: null }),
  ])
  const newsMap = new Map((newsResult.data || []).map((item) => [item.id, item]))
  const eventMap = new Map((eventResult.data || []).map((item) => [item.id, item]))
  return polls.map((poll) => ({
    ...poll,
    linked_publication: poll.linked_event_id
      ? (eventMap.get(poll.linked_event_id) ? { kind: 'event', ...eventMap.get(poll.linked_event_id) } : null)
      : poll.linked_news_id
        ? (newsMap.get(poll.linked_news_id) ? { kind: 'news', ...newsMap.get(poll.linked_news_id) } : null)
        : null,
  }))
}

export default function HomeOpenPolls() {
  const { user } = useAuth()
  const [polls, setPolls] = useState([])
  const [options, setOptions] = useState({})
  const [votes, setVotes] = useState({})
  const [questions, setQuestions] = useState({})
  const [questionAnswers, setQuestionAnswers] = useState({})
  const [queuedVotes, setQueuedVotes] = useState({})
  const [queuedQuestionnaires, setQueuedQuestionnaires] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyPoll, setBusyPoll] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [online, setOnline] = useState(() => navigator.onLine)

  const loadCached = () => {
    const entry = readOfflineEntry(user?.id, 'polls')
    if (!entry?.data) {
      setPolls([]); setOptions({}); setVotes({}); setQuestions({}); setQuestionAnswers({})
      return false
    }
    const snapshot = entry.data
    setPolls(sortPolls((snapshot.polls || []).filter(isOpen)))
    setOptions(groupOptions(snapshot.options || []))
    setVotes(groupVotes(snapshot.votes || []))
    setQuestions(groupByPoll(snapshot.questions || []))
    setQuestionAnswers(groupByPoll(snapshot.questionAnswers || []))
    return true
  }

  const refreshQueue = async () => {
    if (!user?.id) {
      setQueuedVotes({}); setQueuedQuestionnaires({}); return
    }
    const rows = await listOfflineMutations(user.id).catch(() => [])
    const nextVotes = {}
    const nextQuestionnaires = {}
    for (const row of rows) {
      if (row.type === 'poll_vote' && row.payload?.poll_id && Object.prototype.hasOwnProperty.call(row.payload, 'option_id')) {
        nextVotes[row.payload.poll_id] = row.payload.option_id || null
      }
      if (row.type === 'poll_questionnaire' && row.payload?.poll_id && Array.isArray(row.payload.answers)) {
        nextQuestionnaires[row.payload.poll_id] = row.payload.answers
      }
    }
    setQueuedVotes(nextVotes)
    setQueuedQuestionnaires(nextQuestionnaires)
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
      .select('id,title,description,closes_at,active,created_at,featured,linked_news_id,linked_event_id,poll_type,published')
      .eq('active', true)
      .eq('published', true)
      .order('created_at', { ascending: false })
      .limit(20)

    if (pollError) {
      if (!loadCached()) setError('Impossible de charger les sondages pour le moment.')
      setLoading(false)
      return
    }

    const openBase = (pollData || []).filter((poll) => !poll.closes_at || poll.closes_at > now)
    const openPolls = sortPolls(await attachLinkedPublications(openBase))
    setPolls(openPolls)
    if (!openPolls.length) {
      setOptions({}); setVotes({}); setQuestions({}); setQuestionAnswers({}); setLoading(false)
      return
    }

    const simpleIds = openPolls.filter((poll) => poll.poll_type !== 'questionnaire').map((poll) => poll.id)
    const questionnaireIds = openPolls.filter((poll) => poll.poll_type === 'questionnaire').map((poll) => poll.id)
    const [optionResult, voteResult, questionResult, answerResult] = await Promise.all([
      simpleIds.length ? supabase.from('poll_options').select('id,poll_id,label,sort_order,vote_count').in('poll_id', simpleIds).order('sort_order') : Promise.resolve({ data: [], error: null }),
      simpleIds.length ? supabase.from('poll_votes').select('poll_id,option_id').eq('user_id', user.id).in('poll_id', simpleIds) : Promise.resolve({ data: [], error: null }),
      questionnaireIds.length ? supabase.from('poll_questions').select('id,poll_id,prompt,question_type,sort_order,required,attendance_gate,settings').in('poll_id', questionnaireIds).order('sort_order') : Promise.resolve({ data: [], error: null }),
      questionnaireIds.length ? supabase.from('poll_question_answers').select('poll_id,question_id,answer_boolean,answer_number,answer_text').eq('user_id', user.id).in('poll_id', questionnaireIds) : Promise.resolve({ data: [], error: null }),
    ])

    if (optionResult.error || voteResult.error || questionResult.error || answerResult.error) {
      setError('Les sondages sont disponibles, mais certaines réponses n’ont pas pu être actualisées.')
    }
    setOptions(groupOptions(optionResult.data || []))
    setVotes(groupVotes(voteResult.data || []))
    setQuestions(groupByPoll(questionResult.data || []))
    setQuestionAnswers(groupByPoll(answerResult.data || []))
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
  const featuredCount = useMemo(() => polls.filter((poll) => poll.featured).length, [polls])

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
        const { data: deletedRows, error: deleteError } = await supabase
          .from('poll_votes')
          .delete()
          .eq('poll_id', pollId)
          .eq('user_id', user.id)
          .select('poll_id')
        if (deleteError) throw deleteError
        if (!deletedRows?.length) {
          const { data: remaining, error: remainingError } = await supabase
            .from('poll_votes')
            .select('poll_id')
            .eq('poll_id', pollId)
            .eq('user_id', user.id)
            .maybeSingle()
          if (remainingError) throw remainingError
          if (remaining) throw new Error('Le sondage vient d’être clôturé : votre vote ne peut plus être retiré.')
        }
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
      await load().catch(() => {})
    } finally {
      setBusyPoll(null)
    }
  }

  if (loading && !polls.length) return <section className="home-polls-section"><div className="skeleton-card" /></section>
  if (!polls.length) return null

  return <section className="home-polls-section" aria-labelledby="home-polls-title">
    <div className="home-section-title"><div><span className="eyebrow">Votre avis compte</span><h2 id="home-polls-title">Sondages ouverts</h2></div><span className="home-polls-count">{featuredCount ? `${featuredCount} à la une · ` : ''}{polls.length} ouvert{polls.length > 1 ? 's' : ''}</span></div>
    {!online && <div className="offline-v2-notice compact"><strong>Hors ligne</strong><span>Vos réponses sont conservées sur cet appareil puis synchronisées automatiquement.</span></div>}
    {error && <div className="alert error">{error}</div>}
    {message && <div className="alert success">{message}</div>}
    <div className="home-polls-list">
      {polls.map((poll) => poll.poll_type === 'questionnaire'
        ? <article key={poll.id} className={`poll-card home-poll-card questionnaire-card ${poll.featured ? 'home-poll-featured' : ''}`}>
            <div className="poll-card-head"><div><div className="poll-status-row"><span className="poll-status open">Recensement ouvert</span>{poll.featured && <span className="poll-featured-badge">📌 À la une</span>}</div><h3>{poll.title}</h3>{poll.description && <p>{poll.description}</p>}<small>{poll.closes_at ? `Clôture : ${new Date(poll.closes_at).toLocaleString('fr-FR')}` : 'Sans date de clôture'}</small></div></div>
            <QuestionnaireCard poll={poll} questions={questions[poll.id] || []} answers={questionAnswers[poll.id] || []} pendingAnswers={queuedQuestionnaires[poll.id] || null} linkedPublication={poll.linked_publication} onSaved={async () => { await load(); await refreshQueue() }} />
          </article>
        : <HomePollCard key={poll.id} poll={poll} options={options[poll.id] || []} storedVote={votes[poll.id]} selectedVote={selectedVotes[poll.id]} queuedVote={queuedVotes[poll.id]} hasQueuedVote={hasOwn(queuedVotes, poll.id)} busy={busyPoll === poll.id} onVote={vote} />)}
    </div>
  </section>
}

function HomePollCard({ poll, options, storedVote, selectedVote, queuedVote, hasQueuedVote, busy, onVote }) {
  const baseTotal = options.reduce((sum, option) => sum + Number(option.vote_count || 0), 0)
  let effectiveTotal = baseTotal
  if (hasQueuedVote && storedVote && queuedVote === null) effectiveTotal = Math.max(0, baseTotal - 1)
  else if (hasQueuedVote && !storedVote && queuedVote) effectiveTotal = baseTotal + 1
  const linked = poll.linked_publication

  return <article className={`poll-card home-poll-card ${poll.featured ? 'home-poll-featured' : ''}`}>
    <div className="poll-card-head"><div><div className="poll-status-row"><span className="poll-status open">Vote ouvert</span>{poll.featured && <span className="poll-featured-badge">📌 À la une</span>}</div><h3>{poll.title}</h3>{poll.description && <p>{poll.description}</p>}{linked && <div className="home-poll-linked-publication"><span>{linked.kind === 'event' ? 'Événement associé' : 'Publication associée'}</span><strong>{linked.title}</strong>{linked.kind === 'event' && linked.starts_at && <small>{new Date(linked.starts_at).toLocaleString('fr-FR')}{linked.location ? ` · ${linked.location}` : ''}</small>}</div>}<small>{poll.closes_at ? `Clôture : ${new Date(poll.closes_at).toLocaleString('fr-FR')}` : 'Sans date de clôture'}</small>{hasQueuedVote && <span className="offline-pending-badge">⏳ Modification en attente de synchronisation</span>}</div></div>
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
