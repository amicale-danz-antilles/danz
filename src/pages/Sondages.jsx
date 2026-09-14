import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import { QuestionnaireAdminSummary, QuestionnaireBuilder, defaultQuestionnaireQuestions, hydrateQuestionnaireQuestions } from '../components/QuestionnaireAdmin.jsx'
import '../extra.css'
import '../polls-bureau.css'
import '../questionnaires.css'

const publicationKey = (poll) => poll?.linked_event_id ? `event:${poll.linked_event_id}` : poll?.linked_news_id ? `news:${poll.linked_news_id}` : ''
const linkPayload = (value) => {
  const [kind, id] = String(value || '').split(':')
  return { linked_news_id: kind === 'news' && id ? id : null, linked_event_id: kind === 'event' && id ? id : null }
}
const publicationSortTime = (item) => new Date(item.kind === 'event' ? (item.starts_at || item.publish_at || item.created_at) : (item.publish_at || item.published_at || item.created_at)).getTime() || 0
const publicationLabel = (item) => {
  if (item.kind === 'event') {
    const when = item.starts_at ? new Date(item.starts_at).toLocaleDateString('fr-FR') : ''
    return `Événement · ${item.title}${when ? ` · ${when}` : ''}${item.published === false ? ' · brouillon' : ''}`
  }
  return `Information · ${item.title}${item.published === false ? ' · brouillon' : ''}`
}
const isOpen = (poll) => poll.published !== false && poll.active === true && (!poll.closes_at || new Date(poll.closes_at).getTime() > Date.now())
const groupByPoll = (rows = []) => rows.reduce((acc, row) => { (acc[row.poll_id] ||= []).push(row); return acc }, {})
const localDateTime = (value) => { if (!value) return ''; const d = new Date(value); const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16) }

export default function Sondages() {
  const { user, isAdmin } = useAuth()
  const location = useLocation()
  const adminMode = isAdmin && location.pathname.startsWith('/administration/sondages')
  const [polls, setPolls] = useState([])
  const [options, setOptions] = useState({})
  const [votes, setVotes] = useState({})
  const [voterDetails, setVoterDetails] = useState({})
  const [questionnaireQuestions, setQuestionnaireQuestions] = useState({})
  const [questionnaireAnswers, setQuestionnaireAnswers] = useState({})
  const [profilesById, setProfilesById] = useState({})
  const [publicationOptions, setPublicationOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyPoll, setBusyPoll] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [pollMode, setPollMode] = useState('simple')
  const [editingQuestionnaire, setEditingQuestionnaire] = useState(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [choices, setChoices] = useState(['', ''])
  const [questionsDraft, setQuestionsDraft] = useState(defaultQuestionnaireQuestions())
  const [notifyOnPublish, setNotifyOnPublish] = useState(true)
  const [linkedPublication, setLinkedPublication] = useState('')
  const [featured, setFeatured] = useState(false)
  const [creating, setCreating] = useState(false)

  const resetEditor = () => {
    setEditingQuestionnaire(null); setTitle(''); setDescription(''); setClosesAt(''); setChoices(['', '']); setQuestionsDraft(defaultQuestionnaireQuestions()); setNotifyOnPublish(true); setLinkedPublication(''); setFeatured(false); setPollMode('simple')
  }

  const loadPublications = async () => {
    if (!adminMode) return setPublicationOptions([])
    const [newsResult, eventResult] = await Promise.all([
      supabase.from('news').select('id,title,publish_at,published_at,created_at,published').order('publish_at', { ascending: false }).limit(100),
      supabase.from('events').select('id,title,starts_at,ends_at,publish_at,created_at,published,location').order('starts_at', { ascending: false }).limit(100),
    ])
    if (newsResult.error || eventResult.error) setError('La liste des publications associables n’a pas pu être chargée complètement.')
    setPublicationOptions([
      ...(newsResult.data || []).map((item) => ({ ...item, kind: 'news' })),
      ...(eventResult.data || []).map((item) => ({ ...item, kind: 'event' })),
    ].sort((a, b) => publicationSortTime(b) - publicationSortTime(a)))
  }

  const load = async () => {
    setLoading(true); setError('')
    const { data: pollData, error: pollError } = await supabase.from('polls').select('*').order('created_at', { ascending: false })
    if (pollError) { setError(pollError.message); setLoading(false); return }
    const list = pollData || []
    setPolls(list)
    if (!list.length) {
      setOptions({}); setVotes({}); setVoterDetails({}); setQuestionnaireQuestions({}); setQuestionnaireAnswers({}); setProfilesById({}); setLoading(false); return
    }

    const simpleIds = list.filter((poll) => poll.poll_type !== 'questionnaire').map((poll) => poll.id)
    const questionnaireIds = list.filter((poll) => poll.poll_type === 'questionnaire').map((poll) => poll.id)
    const voteQuery = simpleIds.length
      ? (adminMode ? supabase.from('poll_votes').select('poll_id,option_id,user_id,updated_at').in('poll_id', simpleIds) : supabase.from('poll_votes').select('poll_id,option_id,user_id').eq('user_id', user.id).in('poll_id', simpleIds))
      : Promise.resolve({ data: [], error: null })
    const questionnaireAnswerQuery = questionnaireIds.length
      ? (adminMode ? supabase.from('poll_question_answers').select('poll_id,question_id,user_id,answer_boolean,answer_number,answer_text,updated_at').in('poll_id', questionnaireIds) : supabase.from('poll_question_answers').select('poll_id,question_id,user_id,answer_boolean,answer_number,answer_text').eq('user_id', user.id).in('poll_id', questionnaireIds))
      : Promise.resolve({ data: [], error: null })

    const [optionResult, voteResult, questionResult, questionnaireAnswerResult] = await Promise.all([
      simpleIds.length ? supabase.from('poll_options').select('id,poll_id,label,sort_order,vote_count').in('poll_id', simpleIds).order('sort_order') : Promise.resolve({ data: [], error: null }),
      voteQuery,
      questionnaireIds.length ? supabase.from('poll_questions').select('id,poll_id,prompt,question_type,sort_order,required,attendance_gate,settings').in('poll_id', questionnaireIds).order('sort_order') : Promise.resolve({ data: [], error: null }),
      questionnaireAnswerQuery,
    ])
    if (optionResult.error || voteResult.error || questionResult.error || questionnaireAnswerResult.error) setError('Certains détails des sondages n’ont pas pu être chargés.')

    const groupedOptions = groupByPoll(optionResult.data || [])
    Object.values(groupedOptions).forEach((rows) => rows.sort((a, b) => a.sort_order - b.sort_order))
    setOptions(groupedOptions)
    const allVotes = voteResult.data || []
    setVotes(Object.fromEntries(allVotes.filter((vote) => vote.user_id === user.id).map((vote) => [vote.poll_id, vote.option_id])))
    setQuestionnaireQuestions(groupByPoll(questionResult.data || []))
    const allQuestionAnswers = questionnaireAnswerResult.data || []
    setQuestionnaireAnswers(groupByPoll(allQuestionAnswers))

    if (adminMode) {
      const userIds = [...new Set([...allVotes.map((vote) => vote.user_id), ...allQuestionAnswers.map((answer) => answer.user_id)].filter(Boolean))]
      let profileRows = []
      if (userIds.length) {
        const result = await supabase.from('profiles').select('id,full_name,email').in('id', userIds)
        if (result.error) setError('Les résultats sont disponibles, mais certains noms de participants n’ont pas pu être chargés.')
        profileRows = result.data || []
      }
      const profileMap = Object.fromEntries(profileRows.map((profile) => [profile.id, profile]))
      setProfilesById(profileMap)
      const details = {}
      for (const poll of list) details[poll.id] = { total: 0, byOption: {} }
      for (const vote of allVotes) {
        const target = details[vote.poll_id] || (details[vote.poll_id] = { total: 0, byOption: {} })
        target.total += 1
        if (!target.byOption[vote.option_id]) target.byOption[vote.option_id] = []
        const profile = profileMap[vote.user_id]
        target.byOption[vote.option_id].push({ userId: vote.user_id, name: profile?.full_name || profile?.email || 'Compte utilisateur', email: profile?.full_name && profile?.email ? profile.email : '' })
      }
      setVoterDetails(details)
    } else {
      setProfilesById({}); setVoterDetails({})
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [adminMode, user?.id])
  useEffect(() => { loadPublications() }, [adminMode])

  const drafts = useMemo(() => polls.filter((poll) => poll.published === false), [polls])
  const activePolls = useMemo(() => polls.filter((poll) => poll.published !== false && isOpen(poll)), [polls])
  const closedPolls = useMemo(() => polls.filter((poll) => poll.published !== false && !isOpen(poll)), [polls])

  const vote = async (pollId, optionId) => {
    const previous = votes[pollId] || null
    const nextOptionId = previous === optionId ? null : optionId
    setBusyPoll(pollId); setError(''); setMessage('')
    try {
      if (nextOptionId === null) {
        const { data: deletedRows, error: deleteError } = await supabase.from('poll_votes').delete().eq('poll_id', pollId).eq('user_id', user.id).select('poll_id')
        if (deleteError) throw deleteError
        if (!deletedRows?.length) {
          const { data: remaining, error: remainingError } = await supabase.from('poll_votes').select('poll_id').eq('poll_id', pollId).eq('user_id', user.id).maybeSingle()
          if (remainingError) throw remainingError
          if (remaining) throw new Error('Le sondage vient d’être clôturé : votre vote ne peut plus être retiré.')
        }
        setMessage('Votre vote a été retiré.')
      } else {
        const { error: voteError } = await supabase.from('poll_votes').upsert({ poll_id: pollId, user_id: user.id, option_id: nextOptionId, updated_at: new Date().toISOString() }, { onConflict: 'poll_id,user_id' })
        if (voteError) throw voteError
        setMessage(previous ? 'Votre vote a été modifié.' : 'Votre vote a été enregistré.')
      }
      await load()
    } catch (voteError) { setError(voteError?.message || 'Impossible d’enregistrer cette modification de vote.'); await load().catch(() => {}) }
    finally { setBusyPoll(null) }
  }

  const commonPollPayload = () => ({
    title: title.trim(),
    description: description.trim() || null,
    closes_at: closesAt ? new Date(closesAt).toISOString() : null,
    notify_on_publish: notifyOnPublish,
    featured,
    ...linkPayload(linkedPublication),
    updated_at: new Date().toISOString(),
  })

  const createSimplePoll = async (event) => {
    event.preventDefault()
    const cleaned = choices.map((choice) => choice.trim()).filter(Boolean)
    if (!title.trim()) return setError('Ajoutez un titre.')
    if (cleaned.length < 2) return setError('Ajoutez au moins deux propositions.')
    if (new Set(cleaned.map((choice) => choice.toLocaleLowerCase('fr-FR'))).size !== cleaned.length) return setError('Deux propositions sont identiques.')
    if (closesAt && new Date(closesAt).getTime() <= Date.now()) return setError('La date de clôture doit être dans le futur.')
    setCreating(true); setError(''); setMessage('')
    const { data: poll, error: pollError } = await supabase.from('polls').insert({ ...commonPollPayload(), poll_type: 'simple', published: true, created_by: user.id }).select().single()
    if (pollError) { setError(pollError.message); setCreating(false); return }
    const { error: optionError } = await supabase.from('poll_options').insert(cleaned.map((label, index) => ({ poll_id: poll.id, label, sort_order: index + 1 })))
    if (optionError) { await supabase.from('polls').delete().eq('id', poll.id); setError(optionError.message) }
    else { setMessage(notifyOnPublish ? 'Sondage publié. La notification sera traitée automatiquement.' : 'Sondage publié sans notification.'); resetEditor(); setShowCreate(false); await load() }
    setCreating(false)
  }

  const validateQuestionnaire = (publishNow) => {
    if (!title.trim()) throw new Error('Ajoutez un titre au recensement.')
    const [kind, eventId] = String(linkedPublication || '').split(':')
    if (kind !== 'event' || !eventId) throw new Error('Un recensement conditionnel doit être rattaché à un événement.')
    if (closesAt && new Date(closesAt).getTime() <= Date.now()) throw new Error('La date de clôture doit être dans le futur.')
    const attendance = questionsDraft.find((question) => question.attendance_gate)
    if (!attendance || attendance.question_type !== 'yes_no' || !attendance.prompt.trim()) throw new Error('La question obligatoire de présence est invalide.')
    for (const question of questionsDraft) {
      if (!question.prompt.trim()) throw new Error('Toutes les questions doivent avoir un texte.')
      if (question.question_type === 'quantity' && Number(question.settings?.max ?? 10) < Number(question.settings?.min ?? 0)) throw new Error(`Le maximum est inférieur au minimum pour « ${question.prompt} ».`)
      if (question.question_type === 'single_choice') {
        const opts = (question.settings?.options || []).map((value) => String(value).trim()).filter(Boolean)
        if (opts.length < 2) throw new Error(`Ajoutez au moins deux choix pour « ${question.prompt} ».`)
        if (new Set(opts.map((value) => value.toLocaleLowerCase('fr-FR'))).size !== opts.length) throw new Error(`Deux choix sont identiques pour « ${question.prompt} ».`)
      }
    }
    if (publishNow) {
      const eventItem = publicationOptions.find((item) => item.kind === 'event' && item.id === eventId)
      if (!eventItem || eventItem.published === false || (eventItem.publish_at && new Date(eventItem.publish_at).getTime() > Date.now())) throw new Error('Publiez d’abord l’événement associé avant de publier ce recensement.')
    }
  }

  const saveQuestionnaire = async (publishNow) => {
    if (creating) return
    setCreating(true); setError(''); setMessage('')
    let pollId = editingQuestionnaire?.id || null
    let created = false
    try {
      validateQuestionnaire(publishNow)
      const payload = { ...commonPollPayload(), poll_type: 'questionnaire' }
      if (editingQuestionnaire) {
        const { error: updateError } = await supabase.from('polls').update(payload).eq('id', editingQuestionnaire.id)
        if (updateError) throw updateError
        const { error: deleteQuestionsError } = await supabase.from('poll_questions').delete().eq('poll_id', editingQuestionnaire.id)
        if (deleteQuestionsError) throw deleteQuestionsError
      } else {
        const { data: poll, error: insertError } = await supabase.from('polls').insert({ ...payload, published: false, active: true, created_by: user.id, notified_at: null }).select('id').single()
        if (insertError) throw insertError
        pollId = poll.id; created = true
      }

      const rows = questionsDraft.map((question, index) => ({
        poll_id: pollId,
        prompt: question.prompt.trim(),
        question_type: question.attendance_gate ? 'yes_no' : question.question_type,
        sort_order: index + 1,
        required: question.attendance_gate ? true : question.required !== false,
        attendance_gate: question.attendance_gate === true,
        settings: question.question_type === 'single_choice'
          ? { options: (question.settings?.options || []).map((value) => String(value).trim()).filter(Boolean) }
          : question.question_type === 'quantity'
            ? { min: Number(question.settings?.min ?? 0), max: Number(question.settings?.max ?? 10) }
            : {},
      }))
      const { error: questionError } = await supabase.from('poll_questions').insert(rows)
      if (questionError) throw questionError
      if (publishNow) {
        const { error: publishError } = await supabase.from('polls').update({ published: true, active: true, notified_at: null, updated_at: new Date().toISOString() }).eq('id', pollId)
        if (publishError) throw publishError
      }
      setMessage(publishNow ? 'Recensement publié. Les membres peuvent maintenant répondre depuis l’accueil.' : 'Brouillon enregistré. Vous pouvez continuer à modifier ses questions avant publication.')
      resetEditor(); setShowCreate(false); await load()
    } catch (err) {
      if (created && pollId) await supabase.from('polls').delete().eq('id', pollId).catch(() => {})
      setError(err?.message || 'Impossible d’enregistrer le recensement.')
    } finally { setCreating(false) }
  }

  const editDraftQuestionnaire = (poll) => {
    setPollMode('questionnaire'); setEditingQuestionnaire(poll); setTitle(poll.title || ''); setDescription(poll.description || ''); setClosesAt(localDateTime(poll.closes_at)); setNotifyOnPublish(poll.notify_on_publish !== false); setFeatured(poll.featured === true); setLinkedPublication(publicationKey(poll)); setQuestionsDraft(hydrateQuestionnaireQuestions(questionnaireQuestions[poll.id] || defaultQuestionnaireQuestions())); setShowCreate(true); setError(''); setMessage(''); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const publishDraft = async (poll) => {
    const linked = publicationOptions.find((item) => item.kind === 'event' && item.id === poll.linked_event_id)
    if (!linked || linked.published === false || (linked.publish_at && new Date(linked.publish_at).getTime() > Date.now())) return setError('Publiez d’abord l’événement associé avant ce recensement.')
    if (!(questionnaireQuestions[poll.id] || []).some((question) => question.attendance_gate)) return setError('Ce brouillon ne contient pas de question de présence.')
    setBusyPoll(poll.id); setError(''); setMessage('')
    const { error: updateError } = await supabase.from('polls').update({ published: true, active: true, notified_at: null, updated_at: new Date().toISOString() }).eq('id', poll.id)
    if (updateError) setError(updateError.message)
    else { setMessage('Recensement publié.'); await load() }
    setBusyPoll(null)
  }

  const closePoll = async (poll) => {
    if (!window.confirm(`Clôturer « ${poll.title} » maintenant ?`)) return
    const { error: updateError } = await supabase.from('polls').update({ active: false, featured: false, updated_at: new Date().toISOString() }).eq('id', poll.id)
    if (updateError) setError(updateError.message); else await load()
  }
  const resendNotification = async (poll) => {
    if (!isOpen(poll) || !window.confirm(`Renvoyer une notification pour « ${poll.title} » ?`)) return
    setBusyPoll(poll.id); setError(''); setMessage('')
    const { error: updateError } = await supabase.from('polls').update({ notify_on_publish: true, notified_at: null, updated_at: new Date().toISOString() }).eq('id', poll.id)
    if (updateError) setError(updateError.message || 'Impossible de remettre la notification en file d’attente.'); else { setMessage('Notification remise en file d’attente.'); await load() }
    setBusyPoll(null)
  }
  const updatePollLink = async (poll, value) => {
    if (poll.poll_type === 'questionnaire' && value && !String(value).startsWith('event:')) return setError('Un recensement conditionnel doit rester rattaché à un événement.')
    setBusyPoll(poll.id); setError(''); setMessage('')
    const { error: updateError } = await supabase.from('polls').update({ ...linkPayload(value), updated_at: new Date().toISOString() }).eq('id', poll.id)
    if (updateError) setError(updateError.message); else { setMessage(value ? 'Publication associée mise à jour.' : 'Association supprimée.'); await load() }
    setBusyPoll(null)
  }
  const toggleFeatured = async (poll) => {
    setBusyPoll(poll.id); setError(''); setMessage('')
    const next = !poll.featured
    const { error: updateError } = await supabase.from('polls').update({ featured: next, updated_at: new Date().toISOString() }).eq('id', poll.id)
    if (updateError) setError(updateError.message); else { setMessage(next ? 'Sondage placé à la une.' : 'Sondage retiré de la une.'); await load() }
    setBusyPoll(null)
  }
  const removePoll = async (poll) => {
    if (!window.confirm(`Supprimer définitivement « ${poll.title} » et toutes ses réponses ?`)) return
    const { error: deleteError } = await supabase.from('polls').delete().eq('id', poll.id)
    if (deleteError) setError(deleteError.message); else await load()
  }

  const eventOptions = publicationOptions.filter((item) => item.kind === 'event')

  return <>
    <PageTitle eyebrow={adminMode ? 'Administration' : 'Votre avis compte'} title={adminMode ? 'Gestion des sondages' : 'Sondages'} text={adminMode ? 'Créez des sondages simples ou des recensements conditionnels rattachés à un événement. Les résultats nominatifs restent visibles avant et après clôture.' : 'Répondez aux sondages depuis l’accueil.'} />

    {adminMode && <div className="poll-admin-bar"><div><strong>Gestion des sondages</strong><span>Pour un repas ou une activité, utilisez le recensement conditionnel : absent = fin ; présent = questions complémentaires.</span></div><button className="secondary-button" onClick={() => { if (showCreate) { setShowCreate(false); resetEditor() } else setShowCreate(true) }}>{showCreate ? 'Fermer' : '＋ Nouveau sondage'}</button></div>}

    {showCreate && adminMode && <section className="text-panel poll-create-panel"><form onSubmit={pollMode === 'simple' ? createSimplePoll : (event) => event.preventDefault()}>
      <h2>{editingQuestionnaire ? `Modifier le brouillon · ${editingQuestionnaire.title}` : 'Nouveau sondage'}</h2>
      {!editingQuestionnaire && <div className="questionnaire-mode-switch"><button type="button" className={pollMode === 'simple' ? 'active' : ''} onClick={() => setPollMode('simple')}><strong>Sondage simple</strong><br /><small>Une question, un choix.</small></button><button type="button" className={pollMode === 'questionnaire' ? 'active' : ''} onClick={() => { setPollMode('questionnaire'); setLinkedPublication((value) => value.startsWith('event:') ? value : '') }}><strong>Recensement conditionnel</strong><br /><small>Présence puis questions selon la réponse.</small></button></div>}
      <label>Titre<input required maxLength="180" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={pollMode === 'questionnaire' ? 'Ex. Recensement repas du 20 octobre' : 'Ex. Quelle activité préférez-vous ?'} /></label>
      <label>Description (facultatif)<textarea rows="3" maxLength="1200" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Précisez le contexte, la période ou les contraintes." /></label>
      {pollMode === 'questionnaire'
        ? <label>Événement associé <select required value={linkedPublication} onChange={(e) => setLinkedPublication(e.target.value)}><option value="">Choisir un événement</option>{eventOptions.map((item) => <option key={item.id} value={`event:${item.id}`}>{publicationLabel(item)}</option>)}</select><small>Le recensement peut être préparé pendant que l’événement est en brouillon, mais l’événement devra être publié avant le recensement.</small></label>
        : <label>Publication associée (facultatif)<select value={linkedPublication} onChange={(e) => setLinkedPublication(e.target.value)}><option value="">Aucune publication associée</option>{publicationOptions.map((item) => <option key={`${item.kind}-${item.id}`} value={`${item.kind}:${item.id}`}>{publicationLabel(item)}</option>)}</select></label>}
      <label>Date et heure de clôture (facultatif)<input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></label>

      {pollMode === 'simple' ? <div className="poll-choice-editor"><strong>Propositions</strong>{choices.map((choice, index) => <div className="poll-choice-line" key={index}><input required={index < 2} maxLength="180" value={choice} onChange={(e) => setChoices(choices.map((item, i) => i === index ? e.target.value : item))} placeholder={`Proposition ${index + 1}`} />{choices.length > 2 && <button type="button" className="ghost-button" onClick={() => setChoices(choices.filter((_, i) => i !== index))}>Retirer</button>}</div>)}<button type="button" className="ghost-button" onClick={() => setChoices([...choices, ''])}>＋ Ajouter une proposition</button></div>
        : <QuestionnaireBuilder questions={questionsDraft} setQuestions={setQuestionsDraft} />}

      <label className="admin-notification-toggle"><span><strong>Épingler à la une sur l’accueil</strong><small>Le sondage apparaîtra avant les autres tant qu’il reste ouvert.</small></span><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} /></label>
      <label className="admin-notification-toggle"><span><strong>Notifier les utilisateurs à la publication</strong><small>Un brouillon de recensement n’envoie aucune notification avant sa publication.</small></span><input type="checkbox" checked={notifyOnPublish} onChange={(e) => setNotifyOnPublish(e.target.checked)} /></label>
      {error && <div className="alert error">{error}</div>}
      <div className="questionnaire-publish-actions">{pollMode === 'simple' ? <button className="primary-button" disabled={creating}>{creating ? 'Création…' : 'Publier le sondage'}</button> : <><button type="button" className="secondary-button" disabled={creating} onClick={() => saveQuestionnaire(false)}>{creating ? 'Enregistrement…' : 'Enregistrer en brouillon'}</button><button type="button" className="primary-button" disabled={creating} onClick={() => saveQuestionnaire(true)}>{creating ? 'Publication…' : 'Publier le recensement'}</button></>}{editingQuestionnaire && <button type="button" className="ghost-button" onClick={() => { setShowCreate(false); resetEditor() }}>Annuler</button>}</div>
    </form></section>}

    {!showCreate && error && <div className="alert error" style={{ marginBottom: '1rem' }}>{error}</div>}
    {message && <div className="alert success" style={{ marginBottom: '1rem' }}>{message}</div>}

    {loading ? <div className="skeleton-card tall" /> : <>
      {adminMode && drafts.length > 0 && <PollSection title="Brouillons" polls={drafts} options={options} votes={votes} voterDetails={voterDetails} questions={questionnaireQuestions} questionnaireAnswers={questionnaireAnswers} profiles={profilesById} publicationOptions={publicationOptions} busyPoll={busyPoll} isAdmin={adminMode} onVote={vote} onClose={closePoll} onRemove={removePoll} onResend={resendNotification} onLinkChange={updatePollLink} onFeaturedToggle={toggleFeatured} onEditQuestionnaire={editDraftQuestionnaire} onPublishDraft={publishDraft} />}
      <PollSection title="Sondages ouverts" empty="Aucun sondage ouvert pour le moment." polls={activePolls} options={options} votes={votes} voterDetails={voterDetails} questions={questionnaireQuestions} questionnaireAnswers={questionnaireAnswers} profiles={profilesById} publicationOptions={publicationOptions} busyPoll={busyPoll} isAdmin={adminMode} onVote={vote} onClose={closePoll} onRemove={removePoll} onResend={resendNotification} onLinkChange={updatePollLink} onFeaturedToggle={toggleFeatured} />
      {closedPolls.length > 0 && <PollSection title="Sondages clôturés" polls={closedPolls} options={options} votes={votes} voterDetails={voterDetails} questions={questionnaireQuestions} questionnaireAnswers={questionnaireAnswers} profiles={profilesById} publicationOptions={publicationOptions} busyPoll={busyPoll} isAdmin={adminMode} onVote={vote} onClose={closePoll} onRemove={removePoll} onResend={resendNotification} onLinkChange={updatePollLink} onFeaturedToggle={toggleFeatured} />}
    </>}
  </>
}

function PollSection({ title, empty, polls, options, votes, voterDetails, questions, questionnaireAnswers, profiles, publicationOptions, busyPoll, isAdmin, onVote, onClose, onRemove, onResend, onLinkChange, onFeaturedToggle, onEditQuestionnaire, onPublishDraft }) {
  return <section className="poll-section"><div className="section-heading"><div><span className="eyebrow">Activités à venir</span><h2>{title}</h2></div></div><div className="poll-list">{polls.length ? polls.map((poll) => <PollCard key={poll.id} poll={poll} options={options[poll.id] || []} vote={votes[poll.id]} voterInfo={voterDetails[poll.id]} questions={questions[poll.id] || []} questionnaireAnswers={questionnaireAnswers[poll.id] || []} profiles={profiles} publicationOptions={publicationOptions} busy={busyPoll === poll.id} isAdmin={isAdmin} onVote={onVote} onClose={onClose} onRemove={onRemove} onResend={onResend} onLinkChange={onLinkChange} onFeaturedToggle={onFeaturedToggle} onEditQuestionnaire={onEditQuestionnaire} onPublishDraft={onPublishDraft} />) : <div className="empty-state">{empty}</div>}</div></section>
}

function PollCard({ poll, options, vote, voterInfo, questions, questionnaireAnswers, profiles, publicationOptions, busy, isAdmin, onVote, onClose, onRemove, onResend, onLinkChange, onFeaturedToggle, onEditQuestionnaire, onPublishDraft }) {
  const open = isOpen(poll)
  const draft = poll.published === false
  const total = options.reduce((sum, option) => sum + Number(option.vote_count || 0), 0)
  const notificationLabel = draft ? 'Aucune notification avant publication' : poll.notify_on_publish === false ? 'Sans notification' : poll.notified_at ? 'Notification envoyée' : 'Notification en attente'
  const participantCount = isAdmin ? Number(voterInfo?.total || 0) : total
  const linkedKey = publicationKey(poll)
  const linkedItem = publicationOptions.find((item) => `${item.kind}:${item.id}` === linkedKey)
  const questionnaire = poll.poll_type === 'questionnaire'

  return <article className={`poll-card ${questionnaire ? 'questionnaire-card' : ''} ${poll.featured && open ? 'featured-poll-admin' : ''}`}>
    <div className="poll-card-head"><div><div className="poll-status-row">{draft ? <span className="questionnaire-draft-badge">Brouillon</span> : <span className={`poll-status ${open ? 'open' : 'closed'}`}>{questionnaire ? (open ? 'Recensement ouvert' : 'Recensement clôturé') : (open ? 'Vote ouvert' : 'Vote clôturé')}</span>}{questionnaire && <span className="questionnaire-type-badge">Conditionnel</span>}{poll.featured && open && <span className="poll-featured-badge">📌 À la une</span>}</div><h3>{poll.title}</h3>{poll.description && <p>{poll.description}</p>}{linkedKey && <div className="poll-linked-publication"><strong>{questionnaire ? 'Événement associé' : 'Publication associée'}</strong><span>{linkedItem ? publicationLabel(linkedItem) : 'Publication associée conservée'}</span></div>}<small>{poll.closes_at ? `${open ? 'Clôture' : 'Date de clôture'} : ${new Date(poll.closes_at).toLocaleString('fr-FR')}` : 'Sans date de clôture'}</small>{isAdmin && <small className="admin-inline-note"> · {notificationLabel}</small>}</div>
      {isAdmin && <div className="poll-admin-actions">{draft && questionnaire && <button type="button" className="ghost-button" disabled={busy} onClick={() => onEditQuestionnaire(poll)}>Modifier le brouillon</button>}{draft && questionnaire && <button type="button" className="ghost-button" disabled={busy} onClick={() => onPublishDraft(poll)}>Publier</button>}{open && !draft && <button type="button" className="ghost-button" onClick={() => onClose(poll)}>Clôturer</button>}{open && !draft && poll.notified_at && <button type="button" className="ghost-button" disabled={busy} onClick={() => onResend(poll)}>Renvoyer notification</button>}<button type="button" className="ghost-button" onClick={() => onRemove(poll)}>Supprimer</button></div>}
    </div>

    {isAdmin && !draft && <div className="poll-placement-controls"><label>{questionnaire ? 'Événement associé' : 'Publication associée'}<select value={linkedKey} disabled={busy} onChange={(e) => onLinkChange(poll, e.target.value)}><option value="">Aucune</option>{publicationOptions.filter((item) => !questionnaire || item.kind === 'event').map((item) => <option key={`${item.kind}-${item.id}`} value={`${item.kind}:${item.id}`}>{publicationLabel(item)}</option>)}</select></label><button type="button" className={`secondary-button poll-featured-button ${poll.featured && open ? 'active' : ''}`} disabled={busy || !open} onClick={() => onFeaturedToggle(poll)}>{poll.featured && open ? 'Retirer de la une' : '📌 Mettre à la une'}</button></div>}

    {questionnaire ? <>{draft && <div className="questionnaire-editor-note">Ce recensement est invisible pour les membres. Sa structure reste modifiable jusqu’à sa publication.</div>}{isAdmin && <QuestionnaireAdminSummary questions={questions} answers={questionnaireAnswers} profiles={profiles} />}</> : <>
      <div className="poll-options">{options.map((option) => { const count = Number(option.vote_count || 0); const percent = total ? Math.round((count / total) * 100) : 0; const selected = vote === option.id; return <button key={option.id} type="button" className={`poll-option ${selected ? 'selected' : ''}`} disabled={!open || busy || isAdmin} onClick={() => onVote(poll.id, option.id)}><div className="poll-option-top"><span>{selected ? '✓ ' : ''}{option.label}</span><strong>{count} voix · {percent}%</strong></div><span className="poll-result-bar"><span style={{ width: `${percent}%` }} /></span></button> })}</div>
      <small className="poll-total">{participantCount} votant{participantCount > 1 ? 's' : ''}{open && !isAdmin ? ' · Vous pouvez modifier ou retirer votre vote jusqu’à la clôture.' : ''}</small>
      {isAdmin && <div className="poll-voter-panel"><div className="poll-voter-summary"><strong>{participantCount} personne{participantCount > 1 ? 's' : ''} a{participantCount > 1 ? ' ont' : ''} voté</strong><span>{open ? 'Liste actuelle des réponses' : 'Liste finale après clôture'}</span></div><div className="poll-voter-groups">{options.map((option) => { const voters = voterInfo?.byOption?.[option.id] || []; return <div className="poll-voter-group" key={option.id}><div className="poll-voter-group-title"><strong>{option.label}</strong><span>{voters.length} votant{voters.length > 1 ? 's' : ''}</span></div>{voters.length ? <ul>{voters.map((voter, index) => <li key={`${voter.userId}-${index}`}><strong>{voter.name}</strong>{voter.email && <small>{voter.email}</small>}</li>)}</ul> : <small className="poll-voter-empty">Aucun vote pour cette réponse.</small>}</div> })}</div></div>}
    </>}
  </article>
}
