import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { resolvePrivateMediaBatch } from '../lib/mediaStorage.js'
import { PageTitle } from './Actualites.jsx'
import '../extra.css'
import '../home-refactor.css'

const escapeIcs=(value='')=>String(value).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')
const icsDate=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')
function AppleLogo(){return <img className="calendar-brand-logo" src="/danz/apple-logo.svg" alt="" aria-hidden="true"/>}
function GoogleLogo(){return <img className="calendar-brand-logo" src="/danz/google-logo.svg" alt="" aria-hidden="true"/>}

export default function Agenda(){
 const navigate=useNavigate()
 const [items,setItems]=useState([]),[mediaCounts,setMediaCounts]=useState({}),[covers,setCovers]=useState({}),[loading,setLoading]=useState(true),[error,setError]=useState('')
 const load=async()=>{
  setLoading(true);setError('')
  const [eventsResult,galleryResult]=await Promise.all([
   supabase.from('events').select('*').order('starts_at',{ascending:true}),
   supabase.from('gallery').select('id,event_id,media_type,mime_type,storage_provider,storage_path,image_url,created_at').not('event_id','is',null).order('created_at',{ascending:false}),
  ])
  if(eventsResult.error)setError(eventsResult.error.message)
  if(galleryResult.error)setError(galleryResult.error.message)
  const events=eventsResult.data||[],ids=events.map(e=>e.id),galleryRows=galleryResult.data||[]
  setItems(events)
  const counts={};galleryRows.forEach(row=>{if(row.event_id)counts[row.event_id]=(counts[row.event_id]||0)+1});setMediaCounts(counts)
  if(ids.length){
   const {data:assets=[]}=await supabase.from('content_attachments').select('*').in('event_id',ids).eq('is_cover',true)
   const explicitByEvent=new Map(assets.map(asset=>[asset.event_id,asset]))
   const galleryByEvent=new Map()
   for(const media of galleryRows)if(media.media_type==='image'&&!explicitByEvent.has(media.event_id)&&!galleryByEvent.has(media.event_id))galleryByEvent.set(media.event_id,media)
   const candidates=[...galleryByEvent.values()]
   const [assetUrls,galleryUrls]=await Promise.all([
    resolvePrivateMediaBatch(assets,{entity:'attachment',fallbackBucket:'content'}),
    resolvePrivateMediaBatch(candidates,{entity:'gallery',fallbackBucket:'gallery'}),
   ])
   const map={}
   for(const asset of assets){const url=assetUrls.get(asset.id);if(url)map[asset.event_id]=url}
   for(const media of candidates){const url=galleryUrls.get(media.id);if(url&&!map[media.event_id])map[media.event_id]=url}
   setCovers(map)
  }else setCovers({})
  setLoading(false)
 }
 useEffect(()=>{load()},[])
 const addApple=event=>{const start=new Date(event.starts_at),end=event.ends_at?new Date(event.ends_at):new Date(start.getTime()+3600000);const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Amicale DANZ Antilles//Agenda//FR','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${event.id}@amicale-danz-antilles`,`DTSTAMP:${icsDate(new Date())}`,`DTSTART:${icsDate(start)}`,`DTEND:${icsDate(end)}`,`SUMMARY:${escapeIcs(event.title)}`,event.description?`DESCRIPTION:${escapeIcs(event.description)}`:null,event.location?`LOCATION:${escapeIcs(event.location)}`:null,'END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n');const blob=new Blob([lines],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${(event.title||'evenement').replace(/[^a-zA-Z0-9À-ÿ _-]/g,'').trim().replace(/\s+/g,'-')||'evenement'}.ics`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
 const addGoogle=event=>{const start=new Date(event.starts_at),end=event.ends_at?new Date(event.ends_at):new Date(start.getTime()+3600000),params=new URLSearchParams({action:'TEMPLATE',text:event.title||'Événement DANZ',dates:`${icsDate(start)}/${icsDate(end)}`,details:event.description||'',location:event.location||''});window.open(`https://calendar.google.com/calendar/render?${params.toString()}`,'_blank','noopener,noreferrer')}
 const formatEnd=event=>{if(!event.ends_at)return null;const start=new Date(event.starts_at),end=new Date(event.ends_at);return start.toDateString()===end.toDateString()?end.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):end.toLocaleString('fr-FR',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}
 return <><PageTitle eyebrow="Vie de l'amicale" title="Agenda" text="Consultez les rendez-vous et ouvrez leur album photos & vidéos lorsqu’il est disponible."/>{error&&<div className="alert error" style={{marginBottom:'1rem'}}>{error}</div>}{loading?<div className="skeleton-card tall"/>:<div className="timeline">{items.length?items.map(x=>{const d=new Date(x.starts_at),endLabel=formatEnd(x),mediaCount=mediaCounts[x.id]||0;return <article className="timeline-item" key={x.id}><div className="timeline-date"><strong>{d.getDate()}</strong><span>{d.toLocaleDateString('fr-FR',{month:'short',year:'numeric'})}</span></div><div className="timeline-card">
 {covers[x.id]&&<img className="event-cover-image" src={covers[x.id]} alt="" loading="lazy" decoding="async"/>}<div className="event-card-heading"><div><span className="event-time">{d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}{endLabel?` → ${endLabel}`:''}</span><h2>{x.title}</h2></div></div>{x.location&&<p><strong>Lieu :</strong> 📍 {x.location}</p>}{x.description&&<p>{x.description}</p>}<div className="calendar-quick-add"><span>Ajouter au calendrier</span><button type="button" className="calendar-logo-button" aria-label="Ajouter à Apple Calendrier" onClick={()=>addApple(x)}><AppleLogo/></button><button type="button" className="calendar-logo-button" aria-label="Ajouter à Google Agenda" onClick={()=>addGoogle(x)}><GoogleLogo/></button></div>{mediaCount>0&&<div style={{marginTop:'.75rem'}}><button type="button" className="secondary-button" onClick={()=>navigate(`/galerie?event=${x.id}`)}>📷 Ouvrir l’album ({mediaCount})</button></div>}
 </div></article>}) : <div className="empty-state">Aucun événement enregistré.</div>}</div>}</>
}
