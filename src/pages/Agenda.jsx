import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { resolvePrivateMediaBatch } from '../lib/mediaStorage.js'
import { readOfflineData, saveOfflineData } from '../lib/offlineCache.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../extra.css'
import '../home-refactor.css'

const escapeIcs=(value='')=>String(value).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')
const icsDate=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')
const isAlbumExpired=album=>Boolean(album?.transfer_expires_at&&new Date(album.transfer_expires_at).getTime()<Date.now())
const offlineAlbum=album=>album?{id:album.id,event_id:album.event_id,item_count:album.item_count,transfer_expires_at:album.transfer_expires_at}:null
function AppleLogo(){return <img className="calendar-brand-logo" src="/danz/apple-logo.svg" alt="" aria-hidden="true"/>}
function GoogleLogo(){return <img className="calendar-brand-logo" src="/danz/google-logo.svg" alt="" aria-hidden="true"/>}

export default function Agenda(){
 const navigate=useNavigate()
 const {user}=useAuth()
 const [items,setItems]=useState([]),[albums,setAlbums]=useState({}),[covers,setCovers]=useState({}),[loading,setLoading]=useState(true),[error,setError]=useState('')

 const useCached=()=>{
  const cached=readOfflineData(user?.id,'agenda')
  if(!cached)return false
  setItems(cached.items||[]);setAlbums(cached.albums||{});setCovers({})
  setError('Mode hors ligne · agenda affiché depuis la dernière copie enregistrée sur cet appareil.')
  setLoading(false)
  return true
 }

 const load=async()=>{
  setLoading(true);setError('')
  if(!navigator.onLine){if(!useCached()){setError('Aucune copie hors ligne de l’agenda n’est encore disponible sur cet appareil.');setLoading(false)};return}

  const eventsResult=await supabase.from('events').select('*').order('starts_at',{ascending:true})
  if(eventsResult.error&&/fetch|network|failed/i.test(String(eventsResult.error.message||''))&&useCached())return
  if(eventsResult.error)setError('Impossible d’actualiser complètement l’agenda pour le moment.')
  const events=eventsResult.data||[],ids=events.map(e=>e.id)
  setItems(events)
  if(!ids.length){setCovers({});setAlbums({});setLoading(false);if(user?.id)saveOfflineData(user.id,'agenda',{items:[],albums:{}});return}

  const [assetsResult,albumsResult]=await Promise.all([
   supabase.from('content_attachments').select('*').in('event_id',ids).eq('is_cover',true),
   supabase.from('event_albums').select('id,event_id,storage_provider,storage_path,image_url,mime_type,file_size,transfer_url,transfer_expires_at,item_count').in('event_id',ids),
  ])
  if(!eventsResult.error&&(assetsResult.error||albumsResult.error))setError('Les événements sont disponibles, mais certaines miniatures n’ont pas pu être chargées.')
  const assets=assetsResult.data||[],albumRows=albumsResult.data||[]
  const [assetUrls,albumUrls]=await Promise.all([
   resolvePrivateMediaBatch(assets,{entity:'attachment',fallbackBucket:'content'}),
   resolvePrivateMediaBatch(albumRows,{entity:'album',fallbackBucket:'gallery'}),
  ])
  const explicitByEvent=new Map(assets.map(asset=>[asset.event_id,asset])),albumByEvent=new Map(albumRows.map(album=>[album.event_id,album]))
  const coverMap={},albumMap={}
  for(const event of events){
   const explicit=explicitByEvent.get(event.id),album=albumByEvent.get(event.id)
   const albumCover=album?(albumUrls.get(album.id)||album.image_url||null):null
   coverMap[event.id]=(explicit&&assetUrls.get(explicit.id))||albumCover||null
   if(album)albumMap[event.id]=album
  }
  setCovers(coverMap);setAlbums(albumMap);setLoading(false)
  if(user?.id){
   const safeAlbums=Object.fromEntries(Object.entries(albumMap).map(([eventId,album])=>[eventId,offlineAlbum(album)]))
   saveOfflineData(user.id,'agenda',{items:events,albums:safeAlbums})
  }
 }
 useEffect(()=>{load()},[])
 useEffect(()=>{const onOnline=()=>load();window.addEventListener('online',onOnline);return()=>window.removeEventListener('online',onOnline)},[])

 const addApple=event=>{const start=new Date(event.starts_at),end=event.ends_at?new Date(event.ends_at):new Date(start.getTime()+3600000);const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Amicale DANZ Antilles//Agenda//FR','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${event.id}@amicale-danz-antilles`,`DTSTAMP:${icsDate(new Date())}`,`DTSTART:${icsDate(start)}`,`DTEND:${icsDate(end)}`,`SUMMARY:${escapeIcs(event.title)}`,event.description?`DESCRIPTION:${escapeIcs(event.description)}`:null,event.location?`LOCATION:${escapeIcs(event.location)}`:null,'END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n');const blob=new Blob([lines],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${(event.title||'evenement').replace(/[^a-zA-Z0-9À-ÿ _-]/g,'').trim().replace(/\s+/g,'-')||'evenement'}.ics`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
 const addGoogle=event=>{if(!navigator.onLine)return;const start=new Date(event.starts_at),end=event.ends_at?new Date(event.ends_at):new Date(start.getTime()+3600000),params=new URLSearchParams({action:'TEMPLATE',text:event.title||'Événement DANZ',dates:`${icsDate(start)}/${icsDate(end)}`,details:event.description||'',location:event.location||''});window.open(`https://calendar.google.com/calendar/render?${params.toString()}`,'_blank','noopener,noreferrer')}
 const formatEnd=event=>{if(!event.ends_at)return null;const start=new Date(event.starts_at),end=new Date(event.ends_at);return start.toDateString()===end.toDateString()?end.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):end.toLocaleString('fr-FR',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}
 return <><PageTitle eyebrow="Vie de l'amicale" title="Agenda" text="Consultez les rendez-vous et ouvrez leur album de téléchargement lorsqu’il est disponible."/>{error&&<div className={`alert ${error.startsWith('Mode hors ligne')?'warning':'error'}`} style={{marginBottom:'1rem'}}>{error}</div>}{loading?<div className="skeleton-card tall"/>:<div className="timeline">{items.length?items.map(x=>{const d=new Date(x.starts_at),endLabel=formatEnd(x),album=albums[x.id],expired=isAlbumExpired(album);return <article className="timeline-item" key={x.id}><div className="timeline-date"><strong>{d.getDate()}</strong><span>{d.toLocaleDateString('fr-FR',{month:'short',year:'numeric'})}</span></div><div className="timeline-card">
 {covers[x.id]&&<img className="event-cover-image" src={covers[x.id]} alt="" loading="lazy" decoding="async"/>}<div className="event-card-heading"><div><span className="event-time">{d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}{endLabel?` → ${endLabel}`:''}</span><h2>{x.title}</h2></div></div>{x.location&&<p><strong>Lieu :</strong> 📍 {x.location}</p>}{x.description&&<p>{x.description}</p>}<div className="calendar-quick-add"><span>Ajouter au calendrier</span><button type="button" className="calendar-logo-button" aria-label="Ajouter à Apple Calendrier" onClick={()=>addApple(x)}><AppleLogo/></button><button type="button" className="calendar-logo-button" aria-label="Ajouter à Google Agenda" disabled={!navigator.onLine} onClick={()=>addGoogle(x)}><GoogleLogo/></button></div>{album&&<div style={{marginTop:'.75rem'}}>{navigator.onLine?<button type="button" className="secondary-button" onClick={()=>navigate(`/galerie?event=${x.id}`)}>{expired?'📷 Voir la miniature · lien expiré':`📷 Ouvrir l’album${album.item_count!=null?` (${album.item_count})`:''}`}</button>:<span className="login-help">Miniature d’album disponible hors ligne si elle a été synchronisée.</span>}</div>}
 </div></article>}) : <div className="empty-state">Aucun événement enregistré.</div>}</div>}</>
}
