import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { resolvePrivateMedia } from '../lib/mediaStorage.js'
import { PageTitle } from './Actualites.jsx'
import '../extra.css'
import '../home-refactor.css'

const escapeIcs=(value='')=>String(value).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')
const icsDate=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')
const toLocalInput=value=>{if(!value)return'';const date=new Date(value),local=new Date(date.getTime()-date.getTimezoneOffset()*60000);return local.toISOString().slice(0,16)}
function AppleLogo(){return <img className="calendar-brand-logo" src="/danz/apple-logo.svg" alt="" aria-hidden="true"/>}
function GoogleLogo(){return <img className="calendar-brand-logo" src="/danz/google-logo.svg" alt="" aria-hidden="true"/>}

export default function Agenda(){
 const {isAdmin}=useAuth(),navigate=useNavigate()
 const [items,setItems]=useState([]),[mediaCounts,setMediaCounts]=useState({}),[covers,setCovers]=useState({}),[loading,setLoading]=useState(true)
 const [editingId,setEditingId]=useState(null),[edit,setEdit]=useState(null),[saving,setSaving]=useState(false),[error,setError]=useState('')
 const load=async()=>{
  const [eventsResult,mediaResult]=await Promise.all([supabase.from('events').select('*').order('starts_at',{ascending:true}),supabase.from('gallery').select('event_id').not('event_id','is',null)])
  if(eventsResult.error)setError(eventsResult.error.message);if(mediaResult.error)setError(mediaResult.error.message)
  const events=eventsResult.data||[],ids=events.map(e=>e.id);setItems(events)
  const counts={};(mediaResult.data||[]).forEach(row=>{if(row.event_id)counts[row.event_id]=(counts[row.event_id]||0)+1});setMediaCounts(counts)
  if(ids.length){
   const [assetsResult,galleryResult]=await Promise.all([
    supabase.from('content_attachments').select('*').in('event_id',ids).eq('is_cover',true),
    supabase.from('gallery').select('id,event_id,mime_type,storage_provider,storage_path,image_url,media_type').in('event_id',ids).eq('media_type','image').order('created_at',{ascending:false}).limit(50),
   ])
   const map={}
   for(const asset of assetsResult.data||[]){const url=await resolvePrivateMedia(asset,{entity:'attachment',fallbackBucket:'content'});if(url)map[asset.event_id]=url}
   for(const media of galleryResult.data||[]){if(map[media.event_id])continue;const url=await resolvePrivateMedia(media,{entity:'gallery',fallbackBucket:'gallery'});if(url)map[media.event_id]=url}
   setCovers(map)
  }else setCovers({})
  setLoading(false)
 }
 useEffect(()=>{load()},[])
 const addApple=event=>{const start=new Date(event.starts_at),end=event.ends_at?new Date(event.ends_at):new Date(start.getTime()+3600000);const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Amicale DANZ Antilles//Agenda//FR','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${event.id}@amicale-danz-antilles`,`DTSTAMP:${icsDate(new Date())}`,`DTSTART:${icsDate(start)}`,`DTEND:${icsDate(end)}`,`SUMMARY:${escapeIcs(event.title)}`,event.description?`DESCRIPTION:${escapeIcs(event.description)}`:null,event.location?`LOCATION:${escapeIcs(event.location)}`:null,'END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n');const blob=new Blob([lines],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${(event.title||'evenement').replace(/[^a-zA-Z0-9À-ÿ _-]/g,'').trim().replace(/\s+/g,'-')||'evenement'}.ics`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
 const addGoogle=event=>{const start=new Date(event.starts_at),end=event.ends_at?new Date(event.ends_at):new Date(start.getTime()+3600000),params=new URLSearchParams({action:'TEMPLATE',text:event.title||'Événement DANZ',dates:`${icsDate(start)}/${icsDate(end)}`,details:event.description||'',location:event.location||''});window.open(`https://calendar.google.com/calendar/render?${params.toString()}`,'_blank','noopener,noreferrer')}
 const openGallery=(event,e)=>{e?.stopPropagation();navigate(`/galerie?event=${event.id}`)}
 const beginEdit=event=>{if(!isAdmin)return;setEditingId(event.id);setError('');setEdit({title:event.title||'',description:event.description||'',location:event.location||'',startsAt:toLocalInput(event.starts_at),endsAt:toLocalInput(event.ends_at),audience:event.audience||'everyone'})}
 const cancelEdit=()=>{setEditingId(null);setEdit(null);setError('')}
 const saveEdit=async e=>{e.preventDefault();if(!edit?.title?.trim()||!edit?.startsAt)return;setSaving(true);setError('');try{const start=new Date(edit.startsAt),end=edit.endsAt?new Date(edit.endsAt):null;if(end&&end<=start)throw new Error('La fin de l’événement doit être après son début.');const {error:updateError}=await supabase.from('events').update({title:edit.title.trim(),description:edit.description.trim()||null,location:edit.location.trim()||null,starts_at:start.toISOString(),ends_at:end?end.toISOString():null,audience:edit.audience}).eq('id',editingId);if(updateError)throw updateError;await load();cancelEdit()}catch(err){setError(err.message||'Impossible de modifier cet événement.')}finally{setSaving(false)}}
 const formatEnd=event=>{if(!event.ends_at)return null;const start=new Date(event.starts_at),end=new Date(event.ends_at);return start.toDateString()===end.toDateString()?end.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):end.toLocaleString('fr-FR',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}
 return <><PageTitle eyebrow="Vie de l'amicale" title="Agenda" text={isAdmin?"Touchez une tuile pour modifier l’événement. Photos principales et albums souvenirs sont reliés automatiquement.":"Consultez les rendez-vous et ouvrez leur album photos & vidéos lorsqu’il est disponible."}/>{error&&<div className="alert error" style={{marginBottom:'1rem'}}>{error}</div>}{loading?<div className="skeleton-card tall"/>:<div className="timeline">{items.length?items.map(x=>{const d=new Date(x.starts_at),isEditing=editingId===x.id,endLabel=formatEnd(x),mediaCount=mediaCounts[x.id]||0;return <article className="timeline-item" key={x.id}><div className="timeline-date"><strong>{d.getDate()}</strong><span>{d.toLocaleDateString('fr-FR',{month:'short',year:'numeric'})}</span></div><div className={`timeline-card ${isAdmin&&!isEditing?'admin-editable-event':''}`} role={isAdmin&&!isEditing?'button':undefined} tabIndex={isAdmin&&!isEditing?0:undefined} onClick={isAdmin&&!isEditing?()=>beginEdit(x):undefined} onKeyDown={isAdmin&&!isEditing?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();beginEdit(x)}}:undefined}>
 {!isEditing&&<>{covers[x.id]&&<img className="event-cover-image" src={covers[x.id]} alt="" loading="lazy"/>}<div className="event-card-heading"><div><span className="event-time">{d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}{endLabel?` → ${endLabel}`:''}</span><h2>{x.title}</h2></div>{isAdmin&&<span className="admin-edit-hint">✏️ Modifier</span>}</div>{x.location&&<p><strong>Lieu :</strong> 📍 {x.location}</p>}{x.description&&<p>{x.description}</p>}<div className="calendar-quick-add" onClick={e=>e.stopPropagation()}><span>Ajouter au calendrier</span><button type="button" className="calendar-logo-button" aria-label="Ajouter à Apple Calendrier" onClick={()=>addApple(x)}><AppleLogo/></button><button type="button" className="calendar-logo-button" aria-label="Ajouter à Google Agenda" onClick={()=>addGoogle(x)}><GoogleLogo/></button></div>{(mediaCount>0||isAdmin)&&<div style={{marginTop:'.75rem'}} onClick={e=>e.stopPropagation()}><button type="button" className="secondary-button" onClick={e=>openGallery(x,e)}>{mediaCount>0?`📷 Ouvrir l’album (${mediaCount})`:'📷 Créer / compléter l’album'}</button></div>}</>}
 {isEditing&&edit&&<form className="inline-event-edit" onSubmit={saveEdit} onClick={e=>e.stopPropagation()}><span className="eyebrow">Modification administrateur</span><h2>Modifier l’événement</h2><label>Titre<input required value={edit.title} onChange={e=>setEdit({...edit,title:e.target.value})}/></label><label>Description<textarea rows="4" value={edit.description} onChange={e=>setEdit({...edit,description:e.target.value})}/></label><label>Lieu<input value={edit.location} onChange={e=>setEdit({...edit,location:e.target.value})}/></label><label>Début<input type="datetime-local" required value={edit.startsAt} onChange={e=>setEdit({...edit,startsAt:e.target.value})}/></label><label>Fin (facultatif)<input type="datetime-local" value={edit.endsAt} onChange={e=>setEdit({...edit,endsAt:e.target.value})}/></label><label>Audience<select value={edit.audience} onChange={e=>setEdit({...edit,audience:e.target.value})}><option value="everyone">Tout le monde</option><option value="military">Militaires DANZ uniquement</option><option value="amicaliste">Amicalistes uniquement</option><option value="admin">Bureau / Admin uniquement</option></select></label><div style={{display:'flex',gap:'.65rem',flexWrap:'wrap'}}><button className="primary-button" disabled={saving}>{saving?'Enregistrement…':'Enregistrer'}</button><button type="button" className="secondary-button" onClick={cancelEdit}>Annuler</button></div></form>}</div></article>}) : <div className="empty-state">Aucun événement enregistré.</div>}</div>}</>
}
