import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { queueOfflineMutation } from '../lib/offlineMutations.js'
import '../questionnaires.css'

const answerValue = (row) => {
  if (typeof row?.answer_boolean === 'boolean') return row.answer_boolean
  if (row?.answer_number !== null && row?.answer_number !== undefined) return Number(row.answer_number)
  return row?.answer_text ?? ''
}
const answerMapFromRows = (rows = []) => Object.fromEntries(rows.map((row) => [row.question_id, answerValue(row)]))
const answerMapFromPayload = (rows = []) => Object.fromEntries(rows.map((row) => [row.question_id, Object.prototype.hasOwnProperty.call(row, 'answer_boolean') ? row.answer_boolean : Object.prototype.hasOwnProperty.call(row, 'answer_number') ? Number(row.answer_number) : row.answer_text ?? '']))
const normalizedOptions = (question) => Array.isArray(question?.settings?.options) ? question.settings.options.map((value) => String(value)).filter(Boolean) : []
const defaultQuestionValue = (question) => question.question_type === 'quantity' ? Number(question.settings?.min ?? 0) : undefined
const questionPayload = (question, value) => {
  const base = { question_id: question.id }
  if (question.question_type === 'yes_no') return { ...base, answer_boolean: Boolean(value) }
  if (question.question_type === 'quantity') return { ...base, answer_number: Number(value ?? question.settings?.min ?? 0) }
  return { ...base, answer_text: String(value ?? '').trim() }
}

export default function QuestionnaireCard({ poll, questions = [], answers = [], pendingAnswers = null, linkedPublication = null, onSaved }) {
  const { user } = useAuth()
  const attendance = useMemo(() => questions.find((question) => question.attendance_gate) || null, [questions])
  const followups = useMemo(() => questions.filter((question) => !question.attendance_gate).sort((a, b) => a.sort_order - b.sort_order), [questions])
  const initial = useMemo(() => pendingAnswers?.length ? answerMapFromPayload(pendingAnswers) : answerMapFromRows(answers), [answers, pendingAnswers])
  const [values, setValues] = useState(initial)
  const [householdMode, setHouseholdMode] = useState(false)
  const [householdReady, setHouseholdReady] = useState(false)
  const [householdMembers, setHouseholdMembers] = useState([])
  const [selectedMembers, setSelectedMembers] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => { setValues(initial) }, [initial, poll.id])
  useEffect(() => {
    let cancelled = false
    const loadHousehold = async () => {
      setHouseholdReady(false)
      if (!navigator.onLine || !user?.id || !poll?.id) { setHouseholdMode(false); setHouseholdReady(true); return }
      const { data: pollRow } = await supabase.from('polls').select('household_mode').eq('id', poll.id).maybeSingle()
      if (cancelled) return
      if (pollRow?.household_mode !== true) { setHouseholdMode(false); setHouseholdReady(true); return }
      const { data: own } = await supabase.from('household_members').select('household_id').eq('user_id', user.id).maybeSingle()
      if (!own?.household_id || cancelled) { setHouseholdMode(false); setHouseholdReady(true); return }
      const [membersResult, attendanceResult] = await Promise.all([
        supabase.from('household_members').select('id,display_name,member_type,age_category,sort_order').eq('household_id', own.household_id).order('sort_order').order('created_at'),
        supabase.from('poll_household_attendance').select('household_member_id,attending').eq('poll_id', poll.id).eq('household_id', own.household_id),
      ])
      if (cancelled) return
      setHouseholdMembers(membersResult.data || [])
      setSelectedMembers((attendanceResult.data || []).filter((row) => row.attending).map((row) => row.household_member_id))
      setHouseholdMode(true)
      setHouseholdReady(true)
    }
    loadHousehold()
    return () => { cancelled = true }
  }, [poll?.id, user?.id])

  if (!attendance) return <div className="alert error">Ce recensement est incomplet. Contactez un administrateur.</div>

  const computedPresent = householdMode ? selectedMembers.length > 0 : values[attendance.id]
  const setValue = (questionId, value) => { setValues((current) => ({ ...current, [questionId]: value })); setError(''); setSuccess('') }
  const toggleMember = (id) => { setSelectedMembers((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); setError(''); setSuccess('') }
  const validate = () => {
    if (!householdMode && typeof values[attendance.id] !== 'boolean') throw new Error('Indiquez d’abord si vous serez présent(e).')
    if (computedPresent === false) return
    for (const question of followups) {
      const value = values[question.id]
      if (!question.required) continue
      if (question.question_type === 'yes_no' && typeof value !== 'boolean') throw new Error(`Répondez à : ${question.prompt}`)
      if (question.question_type === 'quantity') continue
      if ((question.question_type === 'single_choice' || question.question_type === 'text') && !String(value ?? '').trim()) throw new Error(`Répondez à : ${question.prompt}`)
    }
  }
  const buildAnswers = () => {
    const rows = [questionPayload(attendance, computedPresent)]
    if (!computedPresent) return rows
    for (const question of followups) {
      const value = values[question.id]
      if (question.question_type === 'quantity') { rows.push(questionPayload(question, value ?? defaultQuestionValue(question))); continue }
      if (value === undefined || value === null || (typeof value === 'string' && !value.trim() && !question.required)) continue
      rows.push(questionPayload(question, value))
    }
    return rows
  }

  const submit = async () => {
    if (!user?.id || busy || !householdReady) return
    setBusy(true); setError(''); setSuccess('')
    try {
      validate(); const payload = buildAnswers()
      if (!navigator.onLine) {
        if (householdMode) throw new Error('Le recensement du foyer doit être enregistré avec une connexion Internet afin de synchroniser les personnes présentes.')
        await queueOfflineMutation({ userId: user.id, type: 'poll_questionnaire', dedupeKey: `poll-questionnaire:${poll.id}`, payload: { poll_id: poll.id, answers: payload } })
        setSuccess('Vos réponses sont enregistrées sur cet appareil et seront synchronisées au retour d’Internet.')
      } else {
        const result = householdMode
          ? await supabase.rpc('submit_poll_household_questionnaire', { p_poll_id: poll.id, p_member_ids: selectedMembers, p_answers: payload })
          : await supabase.rpc('submit_poll_questionnaire', { p_poll_id: poll.id, p_answers: payload })
        if (result.error) throw result.error
        setSuccess(computedPresent ? 'Le recensement de votre foyer a bien été enregistré. Vous pouvez le modifier jusqu’à la clôture.' : 'Votre absence a bien été enregistrée.')
        await onSaved?.()
      }
    } catch (err) { setError(err?.message || 'Impossible d’enregistrer ce recensement.') }
    finally { setBusy(false) }
  }

  return <div className="questionnaire-form">
    {linkedPublication && <div className="questionnaire-linked-event"><span>Événement associé</span><strong>{linkedPublication.title}</strong></div>}
    {householdMode ? <div className="questionnaire-question household-attendance-question"><strong>Qui sera présent dans votre foyer ? *</strong><small>Sélectionnez chaque adulte et enfant qui participera. Les enfants sont comptés sans avoir besoin d’un compte.</small><div className="household-attendance-grid">{householdMembers.map((member) => <button type="button" key={member.id} className={`questionnaire-answer-button household-person-button ${selectedMembers.includes(member.id) ? 'selected' : ''}`} onClick={() => toggleMember(member.id)}><span>{member.member_type === 'child' ? '🧒' : '👤'}</span><strong>{member.display_name}</strong><small>{member.member_type === 'child' ? member.age_category : 'Adulte'}</small></button>)}</div>{!householdMembers.length && <div className="alert error">Aucun membre de foyer n’est disponible. Contactez un administrateur.</div>}</div> : <QuestionInput question={attendance} value={values[attendance.id]} onChange={(value) => setValue(attendance.id, value)} />}
    {computedPresent === true ? followups.map((question) => <QuestionInput key={question.id} question={question} value={values[question.id]} onChange={(value) => setValue(question.id, value)} />) : computedPresent === false ? <div className="questionnaire-end-note">Aucune personne du foyer n’est indiquée présente. Le recensement s’arrête ici.</div> : null}
    {pendingAnswers?.length > 0 && <div className="questionnaire-offline-note">⏳ Une version de vos réponses attend actuellement la synchronisation.</div>}
    {error && <div className="alert error">{error}</div>}{success && <div className="alert success">{success}</div>}
    <div className="questionnaire-save-row"><button type="button" className="primary-button" disabled={busy || !householdReady || (!householdMode && typeof computedPresent !== 'boolean')} onClick={submit}>{busy ? 'Enregistrement…' : answers.length || pendingAnswers?.length ? 'Mettre à jour mes réponses' : 'Enregistrer mes réponses'}</button>{answers.length > 0 && <span className="questionnaire-saved">✓ Réponse déjà enregistrée</span>}</div>
  </div>
}

function QuestionInput({ question, value, onChange }) {
  const options = normalizedOptions(question); const min = Number(question.settings?.min ?? 0); const max = Number(question.settings?.max ?? 20); const numericValue = value === undefined || value === null || value === '' ? min : Number(value)
  return <div className="questionnaire-question"><strong>{question.prompt}{question.required ? ' *' : ''}</strong>{question.question_type === 'yes_no' && <div className="questionnaire-yesno"><button type="button" className={`questionnaire-answer-button ${value === true ? 'selected' : ''}`} onClick={() => onChange(true)}>Oui</button><button type="button" className={`questionnaire-answer-button ${value === false ? 'selected' : ''}`} onClick={() => onChange(false)}>Non</button></div>}{question.question_type === 'quantity' && <div className="questionnaire-quantity"><button type="button" aria-label="Diminuer" disabled={numericValue <= min} onClick={() => onChange(Math.max(min, numericValue - 1))}>−</button><output>{numericValue}</output><button type="button" aria-label="Augmenter" disabled={numericValue >= max} onClick={() => onChange(Math.min(max, numericValue + 1))}>+</button></div>}{question.question_type === 'single_choice' && <div className="questionnaire-choice">{options.map((option) => <button type="button" key={option} className={`questionnaire-answer-button ${value === option ? 'selected' : ''}`} onClick={() => onChange(option)}>{option}</button>)}</div>}{question.question_type === 'text' && <textarea rows="3" maxLength="2000" value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder="Votre réponse…" />}{question.question_type === 'quantity' && <small>Utilisez − / + pour choisir une quantité entre {min} et {max}.</small>}</div>
}
