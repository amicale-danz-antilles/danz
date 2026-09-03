import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../extra.css'

export default function Sondages() {
  const { user, isAdmin } = useAuth()
  const [polls, setPolls] = useState([])
  const [options, setOptions] = useState({})
  const [votes, setVotes] = useState({})
  const [results, setResults] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyPoll, setBusyPoll] = useState(null)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [choices, setChoices] = useState(['', ''])
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    const { data: pollData, error: pollError } = await supabase
      .from('polls')
      .select('*')
      .order('created_at', { ascending: false })
    if (pollError) {
      setError(pollError.message)
      setLoading(false)
      return
    }

    const list = pollData || []
    setPolls(list)
    if (!list.length) {
      setOptions({})
      setVotes({})
      setResults({})
      setLoading(false)
      return
    }

    const pollIds = list.map((p) => p.id)
    const [{ data: optionData, error: optionError }, { data: voteData, error: voteError }] = await Promise.all([
      supabase.from('poll_options').select('*').in('poll_id', pollIds).order('sort_order'),
      supabase.from('poll_votes').select('poll_id,option_id,user_id').eq('user_id', user.id),
    ])
    if (optionError) setError(optionError.message)
    if (voteError) setError(voteError.message)

    const groupedOptions = {}
    for (const option of optionData || []) {
      if (!groupedOptions[option.poll_id]) groupedOptions[option.poll_id] = []
      groupedOptions[option.poll_id].push(option)
    }
    setOptions(groupedOptions)

    const ownVotes = {}
    for (const vote of voteData || []) ownVotes[vote.poll_id] = vote.option_id
    setVotes(ownVotes)

    const resultPairs = await Promise.all(list.map(async (poll) => {
      const { data } = await supabase.rpc('get_poll_results', { p_poll_id: poll.id })
      return [poll.id, data || []]
    }))
    setResults(Object.fromEntries(resultPairs))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const activePolls = useMemo(() => polls.filter((poll) => isOpen(poll)), [polls])
  const closedPolls = useMemo(() => polls.filter((poll) => !isOpen(poll)), [polls])

  const vote = async (pollId, optionId) => {
    setBusyPoll(pollId)
    setError('')
    const { error: voteError } = await supabase.from('poll_votes').upsert({
      poll_id: pollId,
      user_id: user.id,
      option_id: optionId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'poll_id,user_id' })
    if (voteError) setError(voteError.message)
    else await load()
    setBusyPoll(null)
  }

  const createPoll = async (event) => {
    event.preventDefault()
    const cleaned = choices.map((choice) => choice.trim()).filter(Boolean)
    if (cleaned.length < 2) {
      setError('Ajoutez au moins deux propositions.')
      return
    }
    setCreating(true)
    setError('')
    const { data: poll, error: pollError } = await supabase.from('polls').insert({
      title: title.trim(),
      description: description.trim() || null,
      closes_at: closesAt ? new Date(closesAt).toISOString() : null,
      created_by: user.id,
    }).select().single()
    if (pollError) {
      setError(pollError.message)
      setCreating(false)
      return
    }

    const { error: optionError } = await supabase.from('poll_options').insert(cleaned.map((label, index) => ({
      poll_id: poll.id,
      label,
      sort_order: index + 1,
    })))
    if (optionError) {
      await supabase.from('polls').delete().eq('id', poll.id)
      setError(optionError.message)
    } else {
      setTitle('')
      setDescription('')
      setClosesAt('')
      setChoices(['', ''])
      setShowCreate(false)
      await load()
    }
    setCreating(false)
  }

  const closePoll = async (poll) => {
    if (!window.confirm(`Clôturer « ${poll.title} » maintenant ?`)) return
    const { error: updateError } = await supabase.from('polls').update({ active: false, updated_at: new Date().toISOString() }).eq('id', poll.id)
    if (updateError) setError(updateError.message)
    else await load()
  }

  const removePoll = async (poll) => {
    if (!window.confirm(`Supprimer définitivement « ${poll.title} » et tous ses votes ?`)) return
    const { error: deleteError } = await supabase.from('polls').delete().eq('id', poll.id)
    if (deleteError) setError(deleteError.message)
    else await load()
  }

  return <>
    <PageTitle eyebrow="Votre avis compte" title="Sondages" text="Votez pour les futures activités de l’Amicale et suivez les préférences des membres." />

    {isAdmin && <div className="poll-admin-bar">
      <div><strong>Gestion des sondages</strong><span>Créez un vote pour choisir une prochaine activité ou recueillir l’avis des membres.</span></div>
      <button className="secondary-button" onClick={() => setShowCreate(!showCreate)}>{showCreate ? 'Fermer' : '＋ Nouveau sondage'}</button>
    </div>}

    {showCreate && isAdmin && <section className="text-panel poll-create-panel">
      <form onSubmit={createPoll}>
        <h2>Nouveau sondage</h2>
        <label>Titre<input required maxLength="180" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Quelle activité pour le mois prochain ?" /></label>
        <label>Description (facultatif)<textarea rows="3" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Précisez le contexte, la période ou les contraintes." /></label>
        <label>Date et heure de clôture (facultatif)<input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></label>
        <div className="poll-choice-editor">
          <strong>Propositions</strong>
          {choices.map((choice, index) => <div className="poll-choice-line" key={index}>
            <input value={choice} onChange={(e) => setChoices(choices.map((item, i) => i === index ? e.target.value : item))} placeholder={`Proposition ${index + 1}`} />
            {choices.length > 2 && <button type="button" className="ghost-button" onClick={() => setChoices(choices.filter((_, i) => i !== index))}>Retirer</button>}
          </div>)}
          <button type="button" className="ghost-button" onClick={() => setChoices([...choices, ''])}>＋ Ajouter une proposition</button>
        </div>
        <button className="primary-button" disabled={creating}>{creating ? 'Création…' : 'Publier le sondage'}</button>
      </form>
    </section>}

    {error && <div className="alert error" style={{marginBottom:'1rem'}}>{error}</div>}

    {loading ? <div className="skeleton-card tall" /> : <>
      <PollSection title="Sondages ouverts" empty="Aucun sondage ouvert pour le moment." polls={activePolls} options={options} votes={votes} results={results} busyPoll={busyPoll} isAdmin={isAdmin} onVote={vote} onClose={closePoll} onRemove={removePoll} />
      {closedPolls.length > 0 && <PollSection title="Sondages clôturés" polls={closedPolls} options={options} votes={votes} results={results} busyPoll={busyPoll} isAdmin={isAdmin} onVote={vote} onClose={closePoll} onRemove={removePoll} />}
    </>}
  </>
}

function PollSection({ title, empty, polls, options, votes, results, busyPoll, isAdmin, onVote, onClose, onRemove }) {
  return <section className="poll-section">
    <div className="section-heading"><div><span className="eyebrow">Activités à venir</span><h2>{title}</h2></div></div>
    <div className="poll-list">
      {polls.length ? polls.map((poll) => <PollCard key={poll.id} poll={poll} options={options[poll.id] || []} vote={votes[poll.id]} results={results[poll.id] || []} busy={busyPoll === poll.id} isAdmin={isAdmin} onVote={onVote} onClose={onClose} onRemove={onRemove} />) : <div className="empty-state">{empty}</div>}
    </div>
  </section>
}

function PollCard({ poll, options, vote, results, busy, isAdmin, onVote, onClose, onRemove }) {
  const open = isOpen(poll)
  const counts = Object.fromEntries(results.map((row) => [row.option_id, Number(row.vote_count || 0)]))
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)

  return <article className="poll-card">
    <div className="poll-card-head">
      <div>
        <span className={`poll-status ${open ? 'open' : 'closed'}`}>{open ? 'Vote ouvert' : 'Vote clôturé'}</span>
        <h3>{poll.title}</h3>
        {poll.description && <p>{poll.description}</p>}
        <small>{poll.closes_at ? `${open ? 'Clôture' : 'Clôturé'} : ${new Date(poll.closes_at).toLocaleString('fr-FR')}` : 'Sans date de clôture'}</small>
      </div>
      {isAdmin && <div className="poll-admin-actions">
        {open && <button type="button" className="ghost-button" onClick={() => onClose(poll)}>Clôturer</button>}
        <button type="button" className="ghost-button" onClick={() => onRemove(poll)}>Supprimer</button>
      </div>}
    </div>

    <div className="poll-options">
      {options.map((option) => {
        const count = counts[option.id] || 0
        const percent = total ? Math.round((count / total) * 100) : 0
        const selected = vote === option.id
        return <button
          key={option.id}
          type="button"
          className={`poll-option ${selected ? 'selected' : ''}`}
          disabled={!open || busy}
          onClick={() => onVote(poll.id, option.id)}
        >
          <div className="poll-option-top"><span>{selected ? '✓ ' : ''}{option.label}</span><strong>{count} voix · {percent}%</strong></div>
          <span className="poll-result-bar"><span style={{width:`${percent}%`}} /></span>
        </button>
      })}
    </div>
    <small className="poll-total">{total} vote{total > 1 ? 's' : ''}{open ? ' · Vous pouvez changer votre choix tant que le sondage est ouvert.' : ''}</small>
  </article>
}

function isOpen(poll) {
  return poll.active === true && (!poll.closes_at || new Date(poll.closes_at).getTime() > Date.now())
}
