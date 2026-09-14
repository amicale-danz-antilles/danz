import { useMemo } from 'react'
import '../questionnaires.css'

const keyFor = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const defaultQuestionnaireQuestions = () => [
  { clientKey: keyFor(), prompt: 'Serez-vous présent(e) ?', question_type: 'yes_no', required: true, attendance_gate: true, settings: {} },
  { clientKey: keyFor(), prompt: 'Votre conjoint(e) sera-t-il/elle présent(e) ?', question_type: 'yes_no', required: true, attendance_gate: false, settings: {} },
  { clientKey: keyFor(), prompt: 'Combien de portions enfant souhaitez-vous ?', question_type: 'quantity', required: true, attendance_gate: false, settings: { min: 0, max: 10 } },
  { clientKey: keyFor(), prompt: 'Combien de portions supplémentaires souhaitez-vous ?', question_type: 'quantity', required: true, attendance_gate: false, settings: { min: 0, max: 10 } },
]

export const hydrateQuestionnaireQuestions = (rows = []) => rows
  .slice()
  .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
  .map((row) => ({ ...row, clientKey: row.id || keyFor(), settings: row.settings || {} }))

export function QuestionnaireBuilder({ questions, setQuestions, disabled = false }) {
  const update = (index, patch) => setQuestions((current) => current.map((question, i) => i === index ? { ...question, ...patch } : question))
  const remove = (index) => setQuestions((current) => current.filter((_, i) => i !== index))
  const move = (index, direction) => setQuestions((current) => {
    const target = index + direction
    if (target < 1 || target >= current.length) return current
    const next = [...current]
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  })
  const add = () => setQuestions((current) => [...current, { clientKey: keyFor(), prompt: 'Nouvelle question', question_type: 'yes_no', required: true, attendance_gate: false, settings: {} }])

  return <div className="questionnaire-builder">
    <div className="questionnaire-editor-note"><strong>Logique du recensement :</strong> la première question « présence » est obligatoire. Une réponse « Non » termine immédiatement le questionnaire. Toutes les autres questions ne sont affichées que si la personne répond « Oui ».</div>
    <div className="questionnaire-questions">
      {questions.map((question, index) => <div key={question.clientKey || question.id || index} className={`questionnaire-question-editor ${question.attendance_gate ? 'attendance' : ''}`}>
        <div className="questionnaire-question-head"><strong>{question.attendance_gate ? 'Question de branchement obligatoire' : `Question ${index + 1}`}</strong><small>{question.attendance_gate ? 'Non = fin · Oui = suite' : 'Visible uniquement si la personne est présente'}</small></div>
        <div className="questionnaire-question-grid">
          <label>Question<input disabled={disabled} maxLength="260" value={question.prompt} onChange={(event) => update(index, { prompt: event.target.value })} /></label>
          <label>Type<select disabled={disabled || question.attendance_gate} value={question.question_type} onChange={(event) => update(index, { question_type: event.target.value, settings: event.target.value === 'quantity' ? { min: 0, max: 10 } : event.target.value === 'single_choice' ? { options: ['Option 1', 'Option 2'] } : {} })}><option value="yes_no">Oui / Non</option><option value="quantity">Quantité (+ / −)</option><option value="single_choice">Choix unique</option><option value="text">Texte libre</option></select></label>
          <label>Obligatoire<select disabled={disabled || question.attendance_gate} value={question.required ? 'yes' : 'no'} onChange={(event) => update(index, { required: event.target.value === 'yes' })}><option value="yes">Oui</option><option value="no">Non</option></select></label>
        </div>
        {question.question_type === 'quantity' && <div className="questionnaire-question-grid"><label>Minimum<input type="number" disabled={disabled} min="0" max="99" value={Number(question.settings?.min ?? 0)} onChange={(event) => update(index, { settings: { ...question.settings, min: Number(event.target.value || 0) } })} /></label><label>Maximum<input type="number" disabled={disabled} min="1" max="99" value={Number(question.settings?.max ?? 10)} onChange={(event) => update(index, { settings: { ...question.settings, max: Number(event.target.value || 10) } })} /></label></div>}
        {question.question_type === 'single_choice' && <label>Choix proposés<textarea rows="4" disabled={disabled} value={(question.settings?.options || []).join('\n')} onChange={(event) => update(index, { settings: { ...question.settings, options: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) } })} /><small>Un choix par ligne. Exemple : Menu 1 / Menu 2.</small></label>}
        {!disabled && !question.attendance_gate && <div className="questionnaire-question-actions"><button type="button" className="ghost-button" disabled={index <= 1} onClick={() => move(index, -1)}>↑ Monter</button><button type="button" className="ghost-button" disabled={index >= questions.length - 1} onClick={() => move(index, 1)}>↓ Descendre</button><button type="button" className="ghost-button admin-danger-button" onClick={() => remove(index)}>Retirer</button></div>}
      </div>)}
    </div>
    {!disabled && <button type="button" className="secondary-button" onClick={add}>＋ Ajouter une question</button>}
  </div>
}

const printableAnswer = (question, answer) => {
  if (!answer) return '—'
  if (question.question_type === 'yes_no') return answer.answer_boolean ? 'Oui' : 'Non'
  if (question.question_type === 'quantity') return String(answer.answer_number ?? 0)
  return answer.answer_text || '—'
}

export function QuestionnaireAdminSummary({ questions = [], answers = [], profiles = {} }) {
  const attendance = questions.find((question) => question.attendance_gate)
  const summary = useMemo(() => {
    const byUser = {}
    for (const answer of answers) {
      if (!byUser[answer.user_id]) byUser[answer.user_id] = {}
      byUser[answer.user_id][answer.question_id] = answer
    }
    const users = Object.entries(byUser).map(([userId, rows]) => ({ userId, rows, profile: profiles[userId] || null }))
    const present = attendance ? users.filter((entry) => entry.rows[attendance.id]?.answer_boolean === true).length : 0
    const absent = attendance ? users.filter((entry) => entry.rows[attendance.id]?.answer_boolean === false).length : 0
    return { users, present, absent }
  }, [answers, attendance?.id, profiles])

  return <div className="questionnaire-admin-summary">
    <div className="questionnaire-kpis"><div className="questionnaire-kpi"><strong>{summary.users.length}</strong><span>réponses enregistrées</span></div><div className="questionnaire-kpi"><strong>{summary.present}</strong><span>présents</span></div><div className="questionnaire-kpi"><strong>{summary.absent}</strong><span>absents</span></div><div className="questionnaire-kpi"><strong>{Math.max(0, summary.present - 0)}</strong><span>foyers présents</span></div></div>
    {questions.map((question) => {
      const rows = answers.filter((answer) => answer.question_id === question.id)
      let breakdown = []
      if (question.question_type === 'yes_no') {
        breakdown = [`Oui : ${rows.filter((row) => row.answer_boolean === true).length}`, `Non : ${rows.filter((row) => row.answer_boolean === false).length}`]
      } else if (question.question_type === 'quantity') {
        const total = rows.reduce((sum, row) => sum + Number(row.answer_number || 0), 0)
        breakdown = [`Total : ${total}`, `${rows.length} réponse${rows.length > 1 ? 's' : ''}`]
      } else if (question.question_type === 'single_choice') {
        breakdown = (question.settings?.options || []).map((option) => `${option} : ${rows.filter((row) => row.answer_text === option).length}`)
      } else {
        breakdown = [`${rows.length} réponse${rows.length > 1 ? 's' : ''}`]
      }
      return <div className="questionnaire-admin-question" key={question.id}><div><strong>{question.prompt}</strong><small>{question.attendance_gate ? 'Branchement présence' : question.question_type}</small></div><div className="questionnaire-breakdown">{breakdown.map((item) => <span key={item}>{item}</span>)}</div></div>
    })}
    <div className="questionnaire-response-list">{summary.users.map((entry) => <div className="questionnaire-response-card" key={entry.userId}><strong>{entry.profile?.full_name || entry.profile?.email || 'Utilisateur'}</strong>{entry.profile?.full_name && entry.profile?.email && <small>{entry.profile.email}</small>}<div className="questionnaire-response-grid">{questions.filter((question) => entry.rows[question.id]).map((question) => <div key={question.id}><span>{question.prompt}</span><strong>{printableAnswer(question, entry.rows[question.id])}</strong></div>)}</div></div>)}</div>
  </div>
}
