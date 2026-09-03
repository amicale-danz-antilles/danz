import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { PageTitle } from './Actualites.jsx'

const escapeIcs = (value = '') => String(value)
  .replace(/\\/g, '\\\\')
  .replace(/\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;')

const icsDate = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const googleDate = (value) => icsDate(value)

export default function Agenda(){
 const [items,setItems]=useState([])
 const [loading,setLoading]=useState(true)
 const [openId,setOpenId]=useState(null)

 useEffect(()=>{
  supabase.from('events').select('*').order('starts_at',{ascending:true}).then(({data})=>{
    setItems(data||[])
    setLoading(false)
  })
 },[])

 const addIcs = (event) => {
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

 const openGoogle = (event) => {
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

 return <>
  <PageTitle eyebrow="Vie de l'amicale" title="Agenda" text="Réunions, sorties, rencontres et temps forts à venir. Touchez un événement pour l’ajouter à votre calendrier." />
  {loading?<div className="skeleton-card tall"/>:<div className="timeline">
   {items.length?items.map(x=>{
    const d=new Date(x.starts_at)
    const expanded=openId===x.id
    return <article className="timeline-item" key={x.id}>
      <div className="timeline-date"><strong>{d.getDate()}</strong><span>{d.toLocaleDateString('fr-FR',{month:'short',year:'numeric'})}</span></div>
      <div className="timeline-card" role="button" tabIndex="0" onClick={()=>setOpenId(expanded?null:x.id)} onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setOpenId(expanded?null:x.id)}}} style={{cursor:'pointer'}}>
        <span className="event-time">{d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span>
        <h2>{x.title}</h2>
        {x.location&&<p>📍 {x.location}</p>}
        {x.description&&<p>{x.description}</p>}
        {expanded&&<div style={{marginTop:'1rem',paddingTop:'1rem',borderTop:'1px solid rgba(0,0,0,.1)'}} onClick={(e)=>e.stopPropagation()}>
          {x.ends_at&&<p><strong>Fin :</strong> {new Date(x.ends_at).toLocaleString('fr-FR')}</p>}
          <div style={{display:'flex',gap:'.65rem',flexWrap:'wrap'}}>
            <button type="button" className="primary-button" onClick={()=>addIcs(x)}>📅 Ajouter au calendrier</button>
            <button type="button" className="ghost-button" onClick={()=>openGoogle(x)}>Google Agenda</button>
          </div>
          <small style={{display:'block',marginTop:'.65rem'}}>Le fichier calendrier est compatible avec Apple Calendrier, Outlook et la plupart des applications de calendrier.</small>
        </div>}
      </div>
    </article>
   }):<div className="empty-state">Aucun événement enregistré.</div>}
  </div>}
 </>
}
