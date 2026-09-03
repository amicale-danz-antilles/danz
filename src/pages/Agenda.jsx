import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../extra.css'

const escapeIcs = (value = '') => String(value)
  .replace(/\\/g, '\\\\')
  .replace(/\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;')

const icsDate = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const googleDate = (value) => icsDate(value)

const toLocalInput = (value) => {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function AppleCalendarIcon() {
  return <span className="calendar-app-icon apple-calendar-icon" aria-hidden="true">
    <span className="calendar-icon-bar" />
    <strong>17</strong>
  </span>
}

function GoogleCalendarIcon() {
  return <span className="calendar-app-icon google-calendar-icon" aria-hidden="true">
    <span className="google-calendar-corner google-calendar-blue" />
    <span className="google-calendar-corner google-calendar-green" />
    <span className="google-calendar-corner google-calendar-yellow" />
    <span className="google-calendar-corner google-calendar-red" />
    <strong>31</strong>
  </span>
}

export default function Agenda(){
 const { isAdmin } = useAuth()
 const [items,setItems]=useState([])
 const [loading,setLoading]=useState(true)
 const [editingId,setEditingId]=useState(null)
 const [edit,setEdit]=useState(null)
 const [saving,setSaving]=useState(false)
 const [error,setError]=useState('')

 const load = async () => {
  const { data, error: loadError } = await supabase.from('events').select('*').order('starts_at',{ascending:true})
  if (loadError) setError(loadError.message)
  setItems(data||[])
  setLoading(false)
 }

 useEffect(()=>{ load() },[])

 const addApple = (event) => {
  const start = new Date(event.starts_at)
  const end = event.ends_at ? new Date(event.ends_at) : new Date(start.getTime() + 60 * 60 * 1000)
  const uid = `${event.id}@amicale-danz-antilles`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Amicale DANZ Antilles//Agenda//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    event.description ? `DESCRIPTION:${escapeIcs(event.description)}` : null,
    event.location ? `LOCATION:${escapeIcs(event.location)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')

  const blob = new Blob([lines], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${(event.title || 'evenement').replace(/[^a-zA-Z0-9À-ÿ _-]/g,'').trim().replace(/\s+/g,'-') || 'evenement'}.ics`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
 }

 const addGoogle = (event) => {
  const start = new Date(event.starts_at)
  const end = event.ends_at ? new Date(event.ends_at) : new Date(start.getTime() + 60 * 60 * 1000)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title || 'Événement DANZ',
    dates: `${googleDate(start)}/${googleDate(end)}`,
    details: event.description || '',
    location: event.location || '',
  })
  window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank', 'noopener,noreferrer')
 }

 const beginEdit = (event) => {
  if (!isAdmin) return
  setEditingId(event.id)
  setError('')
  setEdit({
    title: event.title || '',
    description: event.description || '',
    location: event.location || '',
    startsAt: toLocalInput(event.starts_at),
    endsAt: toLocalInput(event.ends_at),
    audience: event.audience || 'everyone',
  })
 }

 const cancelEdit = () => {
  setEditingId(null)
  setEdit(null)
  setError('')
 }

 const saveEdit = async (event) => {
  event.preventDefault()
  if (!edit?.title?.trim() || !edit?.startsAt) return
  setSaving(true)
  setError('')
  try {
    const start = new Date(edit.startsAt)
    const end = edit.endsAt ? new Date(edit.endsAt) : null
    if (end && end <= start) throw new Error('La fin de l’événement doit être après son début.')

    const { error: updateError } = await supabase.from('events').update({
      title: edit.title.trim(),
      description: edit.description.trim() || null,
      location: edit.location.trim() || null,
      starts_at: start.toISOString(),
      ends_at: end ? end.toISOString() : null,
      audience: edit.audience,
    }).eq('id', editingId)
    if (updateError) throw updateError

    await load()
    cancelEdit()
  } catch (err) {
    setError(err.message || 'Impossible de modifier cet événement.')
  } finally {
    setSaving(false)
  }
 }

 const formatEnd = (event) => {
  if (!event.ends_at) return null
  const start = new Date(event.starts_at)
  const end = new Date(event.ends_at)
  const sameDay = start.toDateString() === end.toDateString()
  return sameDay
    ? end.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})
    : end.toLocaleString('fr-FR',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})
 }

 return <>
  <PageTitle eyebrow="Vie de l'amicale" title="Agenda" text={isAdmin ? "Toutes les informations sont visibles directement. Touchez une tuile pour modifier l’événement." : "Toutes les informations sont visibles directement. Ajoutez un rendez-vous à votre calendrier en touchant simplement son icône."} />
  {error && <div className="alert error" style={{marginBottom:'1rem'}}>{error}</div>}
  {loading?<div className="skeleton-card tall"/>:<div className="timeline">
   {items.length?items.map(x=>{
    const d=new Date(x.starts_at)
    const isEditing=editingId===x.id
    const endLabel=formatEnd(x)
    return <article className="timeline-item" key={x.id}>
      <div className="timeline-date"><strong>{d.getDate()}</strong><span>{d.toLocaleDateString('fr-FR',{month:'short',year:'numeric'})}</span></div>
      <div
        className={`timeline-card ${isAdmin && !isEditing ? 'admin-editable-event' : ''}`}
        role={isAdmin && !isEditing ? 'button' : undefined}
        tabIndex={isAdmin && !isEditing ? 0 : undefined}
        onClick={isAdmin && !isEditing ? ()=>beginEdit(x) : undefined}
        onKeyDown={isAdmin && !isEditing ? (e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();beginEdit(x)}} : undefined}
      >
        {!isEditing && <>
          <div className="event-card-heading">
            <div>
              <span className="event-time">
                {d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
                {endLabel ? ` → ${endLabel}` : ''}
              </span>
              <h2>{x.title}</h2>
            </div>
            {isAdmin && <span className="admin-edit-hint">✏️ Modifier</span>}
          </div>
          {x.location&&<p><strong>Lieu :</strong> 📍 {x.location}</p>}
          {x.description&&<p>{x.description}</p>}
          <div className="calendar-quick-add" onClick={(e)=>e.stopPropagation()}>
            <span>Ajouter au calendrier</span>
            <button type="button" className="calendar-logo-button" title="Ajouter à Apple Calendrier" aria-label="Ajouter à Apple Calendrier" onClick={()=>addApple(x)}>
              <AppleCalendarIcon />
            </button>
            <button type="button" className="calendar-logo-button" title="Ajouter à Google Agenda" aria-label="Ajouter à Google Agenda" onClick={()=>addGoogle(x)}>
              <GoogleCalendarIcon />
            </button>
          </div>
        </>}

        {isEditing && edit && <form className="inline-event-edit" onSubmit={saveEdit} onClick={(e)=>e.stopPropagation()}>
          <span className="eyebrow">Modification administrateur</span>
          <h2 style={{marginTop:'.1rem',marginBottom:'.4rem'}}>Modifier l’événement</h2>
          <label>Titre
            <input type="text" required value={edit.title} onChange={(e)=>setEdit({...edit,title:e.target.value})} />
          </label>
          <label>Description
            <textarea rows="4" value={edit.description} onChange={(e)=>setEdit({...edit,description:e.target.value})} />
          </label>
          <label>Lieu
            <input type="text" value={edit.location} onChange={(e)=>setEdit({...edit,location:e.target.value})} />
          </label>
          <label>Début
            <input type="datetime-local" required value={edit.startsAt} onChange={(e)=>setEdit({...edit,startsAt:e.target.value})} />
          </label>
          <label>Fin (facultatif)
            <input type="datetime-local" value={edit.endsAt} onChange={(e)=>setEdit({...edit,endsAt:e.target.value})} />
          </label>
          <label>Audience
            <select value={edit.audience} onChange={(e)=>setEdit({...edit,audience:e.target.value})}>
              <option value="everyone">Tout le monde</option>
              <option value="military">Militaires DANZ uniquement</option>
              <option value="amicaliste">Amicalistes uniquement</option>
              <option value="admin">Bureau / Admin uniquement</option>
            </select>
          </label>
          <div style={{display:'flex',gap:'.65rem',flexWrap:'wrap',marginTop:'.35rem'}}>
            <button className="primary-button" style={{width:'auto',marginTop:0}} disabled={saving}>{saving?'Enregistrement…':'Enregistrer les modifications'}</button>
            <button type="button" className="secondary-button" disabled={saving} onClick={cancelEdit}>Annuler</button>
          </div>
          <small style={{display:'block',marginTop:'.65rem',color:'var(--muted)'}}>Une correction simple ne renvoie pas automatiquement une nouvelle notification.</small>
        </form>}
      </div>
    </article>
   }):<div className="empty-state">Aucun événement enregistré.</div>}
  </div>}
 </>
}
