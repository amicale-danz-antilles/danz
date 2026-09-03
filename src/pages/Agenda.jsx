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

export default function Agenda(){
 const { isAdmin } = useAuth()
 const [items,setItems]=useState([])
 const [loading,setLoading]=useState(true)
 const [openId,setOpenId]=useState(null)
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

 return <>
  <PageTitle eyebrow="Vie de l'amicale" title="Agenda" text="Réunions, sorties, rencontres et temps forts à venir. Touchez un événement pour voir les détails et l’ajouter à votre calendrier." />
  {error && <div className="alert error" style={{marginBottom:'1rem'}}>{error}</div>}
  {loading?<div className="skeleton-card tall"/>:<div className="timeline">
   {items.length?items.map(x=>{
    const d=new Date(x.starts_at)
    const expanded=openId===x.id
    const isEditing=editingId===x.id
    return <article className="timeline-item" key={x.id}>
      <div className="timeline-date"><strong>{d.getDate()}</strong><span>{d.toLocaleDateString('fr-FR',{month:'short',year:'numeric'})}</span></div>
      <div className="timeline-card" role="button" tabIndex="0" onClick={()=>{ if(!isEditing) setOpenId(expanded?null:x.id) }} onKeyDown={(e)=>{if(!isEditing&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setOpenId(expanded?null:x.id)}}} style={{cursor:isEditing?'default':'pointer'}}>
        {!isEditing && <>
          <span className="event-time">{d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span>
          <h2>{x.title}</h2>
          {x.location&&<p>📍 {x.location}</p>}
          {x.description&&<p>{x.description}</p>}
        </>}

        {expanded && !isEditing && <div style={{marginTop:'1rem',paddingTop:'1rem',borderTop:'1px solid rgba(0,0,0,.1)'}} onClick={(e)=>e.stopPropagation()}>
          {x.ends_at&&<p><strong>Fin :</strong> {new Date(x.ends_at).toLocaleString('fr-FR')}</p>}
          <div style={{display:'flex',gap:'.65rem',flexWrap:'wrap'}}>
            <button type="button" className="primary-button" style={{width:'auto',marginTop:0}} onClick={()=>addApple(x)}>📅 Ajouter calendrier Apple</button>
            <button type="button" className="primary-button" style={{width:'auto',marginTop:0}} onClick={()=>addGoogle(x)}>📅 Ajouter calendrier Google</button>
            {isAdmin && <button type="button" className="secondary-button" onClick={()=>beginEdit(x)}>✏️ Modifier l’événement</button>}
          </div>
          {isAdmin && <small style={{display:'block',marginTop:'.65rem',color:'var(--muted)'}}>La modification d’un événement déjà publié ne renvoie pas automatiquement une nouvelle notification.</small>}
        </div>}

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
        </form>}
      </div>
    </article>
   }):<div className="empty-state">Aucun événement enregistré.</div>}
  </div>}
 </>
}
