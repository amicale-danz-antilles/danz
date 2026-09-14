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
const answerMapFromPayload = (rows = []) => Object.fromEntries(rows.map((row) => [row.question_id,
  Object.prototype.hasOwnProperty.call(row, 'answer_boolean') ? row.answer_boolean
    : Object.prototype.hasOwnProperty.call(row, 'answer_number') ? Number(row.answer_number)
      : row.answer_text ?? ''
]))

const normalizedOptions = (question) => Array.isArray(question?.settings?.options)
  ? question.settings.options.map((value) => String(value)).filter(Boolean)
  : []

const questionPayload = (question, value) => {
  const base = { question_id: question.id }
  if (question.question_type === 'yes_no') return { ...base, answer_boolean: Boolean(value) }
  if (question.question_type === 'quantity') return { ...base, answer_number: Number(value || 0) }
  return { ...base, answer_text: String(value ?? '').trim() }
}

export default function QuestionnaireCard({ poll, questions = [], answers = [], pendingAnswers = null, linkedPublication = null, onSaved }) {
  const { user } = useAuth()
  const attendance = useMemo(() => questions.find((question) => question.attendance_gate) || null, [questions])
  const followups = useMemo(() => questions.filter((question) => !question.attendance_gate).sort((a, b) => a.sort_order - b.sort_order), [questions])
  const initial = useMemo(() => pendingAnswers?.length ? answerMapFromPayload(pendingAnswers) : answerMapFromRows(answers), [answers, pendingAnswers])
  const [values, setValues] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => { setValues(initial) }, [initial, poll.id])

  if (!attendance) return <div className="alert error">Ce recensement est incomplet. Contactez un administrateur.</div>

  const present = values[attendance.id]
  const setValue = (questionId, value) => {
    setValues((current) => ({ ...current, [questionId]: value }))
    setError('')
    setSuccess('')
  }

  const validate = () => {
    if (typeof values[attendance.id] !== 'boolean') throw new Error('Indiquez d’abord si vous serez présent(e).')
    if (values[attendance.id] === false) return
    for (const question of followups) {
      const value = values[question.id]
      if (!question.required) continue
      if (question.question_type === 'yes_no' && typeof value !== 'boolean') throw new Error(`Répondez à : ${question.prompt}`)
      if (question.question_type === 'quantity' && (value === '' || value === null || value === undefined || Number.isNaN(Number(value)))) throw new Error(`Indiquez une quantité pour : ${question.prompt}`)
      if ((question.question_type === 'single_choice' || question.question_type === 'text') && !String(value ?? '').trim()) throw new Error(`Répondez à : ${question.prompt}`)
    }
  }

  const buildAnswers = () => {
    const rows = [questionPayload(attendance, values[attendance.id])]
    if (values[attendance.id] === false) return rows
    for (const question of followups) {
      const value = values[question.id]
      if (value === undefined || value === null || (typeof value === 'string' && !value.trim() && !question.required)) continue
      rows.push(questionPayload(question, value))
    }
    return rows
  }

  const submit = async () => {
    if (!user?.id || busy) return
    setBusy(true); setError(''); setSuccess('')
    try {
      validate()
      const payload = buildAnswers()
      if (!navigator.onLine) {
        await queueOfflineMutation({
          userId: user.id,
          type: 'poll_questionnaire',
          dedupeKey: `poll-questionnaire:${poll.id}`,
          payload: { poll_id: poll.id, answers: payload },
        })
        setSuccess('Vos réponses sont enregistrées sur cet appareil et seront synchronisées au retour d’Internet.')
      } else {
        const { error: submitError } = await supabase.rpc('submit_poll_questionnaire', { p_poll_id: poll.id, p_answers: payload })
        if (submitError) throw submitError
        setSuccess(values[attendance.id] === false ? 'Votre absence a bien été enregistrée.' : 'Votre recensement a bien été enregistré. Vous pouvez le modifier jusqu’à la clôture.')
        await onSaved?.()
      }
    } catch (err) {
      setError(err?.message || 'Impossible d’enregistrer ce recensement.')
    } finally { setBusy(false) }
  }

  return <div className="questionnaire-form">
    {linkedPublication && <div className="questionnaire-linked-event"><span>Événement associé</span><strong>{linkedPublication.title}</strong>{linkedPublication.starts_at && <small>{new Date(linkedPublication.starts_at).toLocaleString('fr-FR')}{linkedPublication.location ? ` · ${linkedPublication.location}` : ''}</small>}</div>}

    <QuestionInput question={attendance} value={values[attendance.id]} onChange={(value) => setValue(attendance.id, value)} />

    {present === true ? followups.map((question) => <QuestionInput key={question.id} question={question} value={values[question.id]} onChange={(value) => setValue(question.id, value)} />)
      : present === false ? <div className="questionnaire-end-note">Vous avez indiqué que vous ne serez pas présent(e). Le recensement s’arrête ici ; aucune autre question n’est nécessaire.</div>
        : null}

    {pendingAnswers?.length > 0 && <div className="questionnaire-offline-note">⏳ Une version de vos réponses attend actuellement la synchronisation.</div>}
    {error && <div className="alert error">{error}</div>}
    {success && <div className="alert success">{success}</div>}
    <div className="questionnaire-save-row"><button type="button" className="primary-button" disabled={busy || typeof present !== 'boolean'} onClick={submit}>{busy ? 'Enregistrement…' : answers.length || pendingAnswers?.length ? 'Mettre à jour mes réponses' : 'Enregistrer mes réponses'}</button>{answers.length > 0 && <span className="questionnaire-saved">✓ Réponse déjà enregistrée</span>}</div>
  </div>
}

function QuestionInput({ question, value, onChange }) {
  const options = normalizedOptions(question)
  const min = Number(question.settings?.min ?? 0)
  const max = Number(question.settings?.max ?? 20)
  const numericValue = value === undefined || value === null || value === '' ? min : Number(value)
  return <div className="questionnaire-question">
    <strong>{question.prompt}{question.required ? ' *' : ''}</strong>
    {question.question_type === 'yes_no' && <div className="questionnaire-yesno"><button type="button" className={`questionnaire-answer-button ${value === true ? 'selected' : ''}`} onClick={() => onChange(true)}>Oui</button><button type="button" className={`questionnaire-answer-button ${value === false ? 'selected' : ''}`} onClick={() => onChange(false)}>Non</button></div>}
    {question.question_type === 'quantity' && <div className="questionnaire-quantity"><button type="button" aria-label="Diminuer" disabled={numericValue <= min} onClick={() => onChange(Math.max(min, numericValue - 1))}>−</button><output>{numericValue}</output><button type="button" aria-label="Augmenter" disabled={numericValue >= max} onClick={() => onChange(Math.min(max, numericValue + 1))}>+</button></div>}
    {question.question_type === 'single_choice' && <div className="questionnaire-choice">{options.map((option) => <button type="button" key={option} className={`questionnaire-answer-button ${value === option ? 'selected' : ''}`} onClick={() => onChange(option)}>{option}</button>)}</div>}
    {question.question_type === 'text' && <textarea rows="3" maxLength="2000" value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder="Votre réponse…" />}
    {question.question_type === 'quantity' && <small>Utilisez − / + pour choisir une quantité entre {min} et {max}.</small>}
  </div>
}
