import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../extra.css'
import '../polls-bureau.css'

const publicationKey = (poll) => poll?.linked_event_id ? `event:${poll.linked_event_id}` : poll?.linked_news_id ? `news:${poll.linked_news_id}` : ''
const linkPayload = (value) => {
  const [kind, id] = String(value || '').split(':')
  return {
    linked_news_id: kind === 'news' && id ? id : null,
    linked_event_id: kind === 'event' && id ? id : null,
  }
}
const publicationSortTime = (item) => new Date(item.kind === 'event' ? (item.starts_at || item.publish_at || item.created_at) : (item.publish_at || item.published_at || item.created_at)).getTime() || 0
const publicationLabel = (item) => {
  if (item.kind === 'event') {
    const when = item.starts_at ? new Date(item.starts_at).toLocaleDateString('fr-FR') : ''
    return `Événement · ${item.title}${when ? ` · ${when}` : ''}`
  }
  return `Information · ${item.title}`
}

export default function Sondages() {
  const { user, isAdmin } = useAuth()
  const location = useLocation()
  const adminMode = isAdmin && location.pathname.startsWith('/administration/sondages')
  const [polls, setPolls] = useState([])
  const [options, setOptions] = useState({})
  const [votes, setVotes] = useState({})
  const [voterDetails, setVoterDetails] = useState({})
  const [publicationOptions, setPublicationOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyPoll, setBusyPoll] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [choices, setChoices] = useState(['', ''])
  const [notifyOnPublish, setNotifyOnPublish] = useState(true)
  const [linkedPublication, setLinkedPublication] = useState('')
  const [featured, setFeatured] = useState(false)
  const [creating, setCreating] = useState(false)

  const loadPublications = async () => {
    if (!adminMode) return setPublicationOptions([])
    const now = new Date().toISOString()
    const [newsResult, eventResult] = await Promise.all([
      supabase.from('news').select('id,title,publish_at,published_at,created_at').eq('published', true).lte('publish_at', now).order('publish_at', { ascending: false }).limit(80),
      supabase.from('events').select('id,title,starts_at,ends_at,publish_at,created_at').eq('published', true).lte('publish_at', now).order('starts_at', { ascending: false }).limit(80),
    ])
    if (newsResult.error || eventResult.error) {
      setError('Les sondages restent disponibles, mais la liste des publications associables n’a pas pu être chargée complètement.')
    }
    const merged = [
      ...(newsResult.data || []).map((item) => ({ ...item, kind: 'news' })),
      ...(eventResult.data || []).map((item) => ({ ...item, kind: 'event' })),
    ].sort((a, b) => publicationSortTime(b) - publicationSortTime(a))
    setPublicationOptions(merged)
  }

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
      setVoterDetails({})
      setLoading(false)
      return
    }

    const pollIds = list.map((p) => p.id)
    const voteQuery = adminMode
      ? supabase.from('poll_votes').select('poll_id,option_id,user_id,updated_at').in('poll_id', pollIds)
      : supabase.from('poll_votes').select('poll_id,option_id,user_id').eq('user_id', user.id).in('poll_id', pollIds)

    const [{ data: optionData, error: optionError }, { data: voteData, error: voteError }] = await Promise.all([
      supabase.from('poll_options').select('id,poll_id,label,sort_order,vote_count').in('poll_id', pollIds).order('sort_order'),
      voteQuery,
    ])
    if (optionError) setError(optionError.message)
    if (voteError) setError(voteError.message)

    const groupedOptions = {}
    for (const option of optionData || []) {
      if (!groupedOptions[option.poll_id]) groupedOptions[option.poll_id] = []
      groupedOptions[option.poll_id].push(option)
    }
    setOptions(groupedOptions)

    const allVotes = voteData || []
    const ownVotes = {}
    for (const vote of allVotes) {
      if (vote.user_id === user.id) ownVotes[vote.poll_id] = vote.option_id
    }
    setVotes(ownVotes)

    if (adminMode) {
      const userIds = [...new Set(allVotes.map((vote) => vote.user_id).filter(Boolean))]
      let profileMap = new Map()
      if (userIds.length) {
        const { data: profileRows, error: profileError } = await supabase
          .from('profiles')
          .select('id,full_name,email')
          .in('id', userIds)
        if (profileError) setError('Les totaux des sondages sont disponibles, mais certains noms de votants n’ont pas pu être chargés.')
        profileMap = new Map((profileRows || []).map((profile) => [profile.id, profile]))
      }

      const details = {}
      for (const poll of list) details[poll.id] = { total: 0, byOption: {} }
      for (const vote of allVotes) {
        if (!details[vote.poll_id]) details[vote.poll_id] = { total: 0, byOption: {} }
        const target = details[vote.poll_id]
        target.total += 1
        if (!target.byOption[vote.option_id]) target.byOption[vote.option_id] = []
        const profile = profileMap.get(vote.user_id)
        target.byOption[vote.option_id].push({
          userId: vote.user_id,
          name: profile?.full_name || profile?.email || 'Compte utilisateur',
          email: profile?.full_name && profile?.email ? profile.email : '',
          updatedAt: vote.updated_at || null,
        })
      }
      setVoterDetails(details)
    } else {
      setVoterDetails({})
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [adminMode, user?.id])
  useEffect(() => { loadPublications() }, [adminMode])

  const activePolls = useMemo(() => polls.filter((poll) => isOpen(poll)), [polls])
  const closedPolls = useMemo(() => polls.filter((poll) => !isOpen(poll)), [polls])

  const vote = async (pollId, optionId) => {
    const previous = votes[pollId] || null
    const nextOptionId = previous === optionId ? null : optionId
    setBusyPoll(pollId)
    setError('')
    setMessage('')

    try {
      if (nextOptionId === null) {
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
        setMessage('Votre vote a été retiré.')
        await load()
      } else {
        const { error: voteError } = await supabase.from('poll_votes').upsert({
          poll_id: pollId,
          user_id: user.id,
          option_id: nextOptionId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'poll_id,user_id' })
        if (voteError) throw voteError
        setMessage(previous ? 'Votre vote a été modifié.' : 'Votre vote a été enregistré.')
        await load()
      }
    } catch (voteError) {
      setError(voteError?.message || 'Impossible d’enregistrer cette modification de vote.')
      await load().catch(() => {})
    } finally {
      setBusyPoll(null)
    }
  }

  const createPoll = async (event) => {
    event.preventDefault()
    const cleaned = choices.map((choice) => choice.trim()).filter(Boolean)
    if (cleaned.length < 2) return setError('Ajoutez au moins deux propositions.')
    if (new Set(cleaned.map((choice) => choice.toLocaleLowerCase('fr-FR'))).size !== cleaned.length) return setError('Deux propositions sont identiques. Modifiez-les avant de publier le sondage.')
    if (closesAt && new Date(closesAt).getTime() <= Date.now()) return setError('La date de clôture doit être située dans le futur.')

    setCreating(true); setError(''); setMessage('')
    const { data: poll, error: pollError } = await supabase.from('polls').insert({
      title: title.trim(),
      description: description.trim() || null,
      closes_at: closesAt ? new Date(closesAt).toISOString() : null,
      notify_on_publish: notifyOnPublish,
      featured,
      ...linkPayload(linkedPublication),
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
      setTitle(''); setDescription(''); setClosesAt(''); setChoices(['', '']); setNotifyOnPublish(true); setLinkedPublication(''); setFeatured(false); setShowCreate(false)
      setMessage(notifyOnPublish ? 'Sondage publié. La notification sera traitée automatiquement.' : 'Sondage publié sans notification.')
      await load()
    }
    setCreating(false)
  }

  const closePoll = async (poll) => {
    if (!window.confirm(`Clôturer « ${poll.title} » maintenant ?`)) return
    const { error: updateError } = await supabase.from('polls').update({ active: false, featured: false, updated_at: new Date().toISOString() }).eq('id', poll.id)
    if (updateError) setError(updateError.message)
    else await load()
  }

  const resendNotification = async (poll) => {
    if (!isOpen(poll) || !window.confirm(`Renvoyer une notification pour « ${poll.title} » ?`)) return
    setBusyPoll(poll.id); setError(''); setMessage('')
    const { error: updateError } = await supabase.from('polls').update({ notify_on_publish: true, notified_at: null, updated_at: new Date().toISOString() }).eq('id', poll.id)
    if (updateError) setError(updateError.message || 'Impossible de remettre la notification en file d’attente.')
    else { setMessage('Notification du sondage remise en file d’attente.'); await load() }
    setBusyPoll(null)
  }

  const updatePollLink = async (poll, value) => {
    setBusyPoll(poll.id); setError(''); setMessage('')
    const { error: updateError } = await supabase.from('polls').update({ ...linkPayload(value), updated_at: new Date().toISOString() }).eq('id', poll.id)
    if (updateError) setError(updateError.message || 'Impossible de modifier la publication associée.')
    else { setMessage(value ? 'Publication associée au sondage.' : 'Association avec la publication supprimée.'); await load() }
    setBusyPoll(null)
  }

  const toggleFeatured = async (poll) => {
    setBusyPoll(poll.id); setError(''); setMessage('')
    const next = !poll.featured
    const { error: updateError } = await supabase.from('polls').update({ featured: next, updated_at: new Date().toISOString() }).eq('id', poll.id)
    if (updateError) setError(updateError.message || 'Impossible de modifier la mise à la une.')
    else { setMessage(next ? 'Sondage placé à la une de l’accueil.' : 'Sondage retiré de la une.'); await load() }
    setBusyPoll(null)
  }

  const removePoll = async (poll) => {
    if (!window.confirm(`Supprimer définitivement « ${poll.title} » et tous ses votes ?`)) return
    const { error: deleteError } = await supabase.from('polls').delete().eq('id', poll.id)
    if (deleteError) setError(deleteError.message)
    else await load()
  }

  return <>
    <PageTitle eyebrow={adminMode ? 'Administration' : 'Votre avis compte'} title={adminMode ? 'Gestion des sondages' : 'Sondages'} text={adminMode ? 'Créez, rattachez à une publication, placez à la une, clôturez ou supprimez les sondages. Les listes nominatives restent visibles avant et après clôture.' : 'Votez pour les futures activités de l’Amicale et suivez les préférences des membres.'} />

    {adminMode && <div className="poll-admin-bar">
      <div><strong>Gestion des sondages</strong><span>Un sondage peut être lié à une information ou un événement et rester épinglé à la une tant qu’il est ouvert.</span></div>
      <button className="secondary-button" onClick={() => setShowCreate(!showCreate)}>{showCreate ? 'Fermer' : '＋ Nouveau sondage'}</button>
    </div>}

    {showCreate && adminMode && <section className="text-panel poll-create-panel">
      <form onSubmit={createPoll}>
        <h2>Nouveau sondage</h2>
        <label>Titre<input required maxLength="180" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Quelle activité pour le mois prochain ?" /></label>
        <label>Description (facultatif)<textarea rows="3" maxLength="1200" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Précisez le contexte, la période ou les contraintes." /></label>
        <label>Publication associée (facultatif)<select value={linkedPublication} onChange={(e) => setLinkedPublication(e.target.value)}><option value="">Aucune publication associée</option>{publicationOptions.map((item) => <option key={`${item.kind}-${item.id}`} value={`${item.kind}:${item.id}`}>{publicationLabel(item)}</option>)}</select><small>Le sondage affichera le contexte de cette publication sur l’accueil.</small></label>
        <label>Date et heure de clôture (facultatif)<input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></label>
        <div className="poll-choice-editor">
          <strong>Propositions</strong>
          {choices.map((choice, index) => <div className="poll-choice-line" key={index}>
            <input required={index < 2} maxLength="180" value={choice} onChange={(e) => setChoices(choices.map((item, i) => i === index ? e.target.value : item))} placeholder={`Proposition ${index + 1}`} />
            {choices.length > 2 && <button type="button" className="ghost-button" onClick={() => setChoices(choices.filter((_, i) => i !== index))}>Retirer</button>}
          </div>)}
          <button type="button" className="ghost-button" onClick={() => setChoices([...choices, ''])}>＋ Ajouter une proposition</button>
        </div>
        <label className="admin-notification-toggle"><span><strong>Épingler à la une sur l’accueil</strong><small>Le sondage sera placé avant les autres sondages ouverts et restera en haut tant qu’il est actif.</small></span><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} /></label>
        <label className="admin-notification-toggle"><span><strong>Notifier les utilisateurs</strong><small>Respecte le réglage global “Sondages” et la préférence de chaque utilisateur.</small></span><input type="checkbox" checked={notifyOnPublish} onChange={(e) => setNotifyOnPublish(e.target.checked)} /></label>
        <button className="primary-button" disabled={creating}>{creating ? 'Création…' : 'Publier le sondage'}</button>
      </form>
    </section>}

    {error && <div className="alert error" style={{ marginBottom: '1rem' }}>{error}</div>}
    {message && <div className="alert success" style={{ marginBottom: '1rem' }}>{message}</div>}

    {loading ? <div className="skeleton-card tall" /> : <>
      <PollSection title="Sondages ouverts" empty="Aucun sondage ouvert pour le moment." polls={activePolls} options={options} votes={votes} voterDetails={voterDetails} publicationOptions={publicationOptions} busyPoll={busyPoll} isAdmin={adminMode} onVote={vote} onClose={closePoll} onRemove={removePoll} onResend={resendNotification} onLinkChange={updatePollLink} onFeaturedToggle={toggleFeatured} />
      {closedPolls.length > 0 && <PollSection title="Sondages clôturés" polls={closedPolls} options={options} votes={votes} voterDetails={voterDetails} publicationOptions={publicationOptions} busyPoll={busyPoll} isAdmin={adminMode} onVote={vote} onClose={closePoll} onRemove={removePoll} onResend={resendNotification} onLinkChange={updatePollLink} onFeaturedToggle={toggleFeatured} />}
    </>}
  </>
}

function PollSection({ title, empty, polls, options, votes, voterDetails, publicationOptions, busyPoll, isAdmin, onVote, onClose, onRemove, onResend, onLinkChange, onFeaturedToggle }) {
  return <section className="poll-section">
    <div className="section-heading"><div><span className="eyebrow">Activités à venir</span><h2>{title}</h2></div></div>
    <div className="poll-list">
      {polls.length ? polls.map((poll) => <PollCard key={poll.id} poll={poll} options={options[poll.id] || []} vote={votes[poll.id]} voterInfo={voterDetails[poll.id]} publicationOptions={publicationOptions} busy={busyPoll === poll.id} isAdmin={isAdmin} onVote={onVote} onClose={onClose} onRemove={onRemove} onResend={onResend} onLinkChange={onLinkChange} onFeaturedToggle={onFeaturedToggle} />) : <div className="empty-state">{empty}</div>}
    </div>
  </section>
}

function PollCard({ poll, options, vote, voterInfo, publicationOptions, busy, isAdmin, onVote, onClose, onRemove, onResend, onLinkChange, onFeaturedToggle }) {
  const open = isOpen(poll)
  const total = options.reduce((sum, option) => sum + Number(option.vote_count || 0), 0)
  const notificationLabel = poll.notify_on_publish === false ? 'Sans notification' : poll.notified_at ? 'Notification envoyée' : 'Notification en attente'
  const participantCount = isAdmin ? Number(voterInfo?.total || 0) : total
  const linkedKey = publicationKey(poll)
  const linkedItem = publicationOptions.find((item) => `${item.kind}:${item.id}` === linkedKey)

  return <article className={`poll-card ${poll.featured && open ? 'featured-poll-admin' : ''}`}>
    <div className="poll-card-head">
      <div>
        <div className="poll-status-row"><span className={`poll-status ${open ? 'open' : 'closed'}`}>{open ? 'Vote ouvert' : 'Vote clôturé'}</span>{poll.featured && open && <span className="poll-featured-badge">📌 À la une</span>}</div>
        <h3>{poll.title}</h3>
        {poll.description && <p>{poll.description}</p>}
        {linkedKey && <div className="poll-linked-publication"><strong>Publication associée</strong><span>{linkedItem ? publicationLabel(linkedItem) : 'Publication associée conservée'}</span></div>}
        <small>{poll.closes_at ? `${open ? 'Clôture' : 'Date de clôture'} : ${new Date(poll.closes_at).toLocaleString('fr-FR')}` : 'Sans date de clôture'}</small>
        {isAdmin && <small className="admin-inline-note"> · {notificationLabel}</small>}
      </div>
      {isAdmin && <div className="poll-admin-actions">
        {open && <button type="button" className="ghost-button" onClick={() => onClose(poll)}>Clôturer</button>}
        {open && poll.notified_at && <button type="button" className="ghost-button" disabled={busy} onClick={() => onResend(poll)}>Renvoyer notification</button>}
        <button type="button" className="ghost-button" onClick={() => onRemove(poll)}>Supprimer</button>
      </div>}
    </div>

    {isAdmin && <div className="poll-placement-controls">
      <label>Publication associée<select value={linkedKey} disabled={busy} onChange={(e) => onLinkChange(poll, e.target.value)}><option value="">Aucune</option>{publicationOptions.map((item) => <option key={`${item.kind}-${item.id}`} value={`${item.kind}:${item.id}`}>{publicationLabel(item)}</option>)}</select></label>
      <button type="button" className={`secondary-button poll-featured-button ${poll.featured && open ? 'active' : ''}`} disabled={busy || !open} onClick={() => onFeaturedToggle(poll)}>{poll.featured && open ? 'Retirer de la une' : '📌 Mettre à la une'}</button>
    </div>}

    <div className="poll-options">
      {options.map((option) => {
        const count = Number(option.vote_count || 0)
        const percent = total ? Math.round((count / total) * 100) : 0
        const selected = vote === option.id
        return <button key={option.id} type="button" className={`poll-option ${selected ? 'selected' : ''}`} disabled={!open || busy} onClick={() => onVote(poll.id, option.id)}>
          <div className="poll-option-top"><span>{selected ? '✓ ' : ''}{option.label}</span><strong>{count} voix · {percent}%</strong></div>
          <span className="poll-result-bar"><span style={{ width: `${percent}%` }} /></span>
        </button>
      })}
    </div>
    <small className="poll-total">{participantCount} votant{participantCount > 1 ? 's' : ''}{open ? ' · Un membre peut modifier son choix ou retirer son vote tant que le sondage est ouvert.' : ''}</small>

    {isAdmin && <div className="poll-voter-panel">
      <div className="poll-voter-summary"><strong>{participantCount} personne{participantCount > 1 ? 's' : ''} a{participantCount > 1 ? ' ont' : ''} voté</strong><span>{open ? 'Liste actuelle des réponses' : 'Liste finale après clôture'}</span></div>
      <div className="poll-voter-groups">
        {options.map((option) => {
          const voters = voterInfo?.byOption?.[option.id] || []
          return <div className="poll-voter-group" key={option.id}>
            <div className="poll-voter-group-title"><strong>{option.label}</strong><span>{voters.length} votant{voters.length > 1 ? 's' : ''}</span></div>
            {voters.length ? <ul>{voters.map((voter, index) => <li key={`${voter.userId}-${index}`}><strong>{voter.name}</strong>{voter.email && <small>{voter.email}</small>}</li>)}</ul> : <small className="poll-voter-empty">Aucun vote pour cette réponse.</small>}
          </div>
        })}
      </div>
    </div>}
  </article>
}

function isOpen(poll) {
  return poll.active === true && (!poll.closes_at || new Date(poll.closes_at).getTime() > Date.now())
}
