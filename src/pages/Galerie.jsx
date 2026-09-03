import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getR2Status, removePrivateMedia, resolvePrivateMedia, uploadPrivateMedia } from '../lib/mediaStorage.js'
import { PageTitle } from './Actualites.jsx'
import '../gallery-events.css'

const IMAGE_LIMIT = 20 * 1024 * 1024
const VIDEO_LIMIT = 200 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
const formatDate = (value) => value ? new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}) : ''

export default function Galerie(){
  const { user, isAdmin } = useAuth()
  const [searchParams,setSearchParams]=useSearchParams()
  const selectedEventId=searchParams.get('event')||''
  const [items,setItems]=useState([])
  const [events,setEvents]=useState([])
  const [loading,setLoading]=useState(true)
  const [uploadEventId,setUploadEventId]=useState(selectedEventId)
  const [files,setFiles]=useState([])
  const [caption,setCaption]=useState('')
  const [uploading,setUploading]=useState(false)
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')
  const [r2Ready,setR2Ready]=useState(false)

  const load=async()=>{
    setLoading(true)
    const [galleryResult,eventsResult]=await Promise.all([
      supabase.from('gallery').select('*, event:events(id,title,description,location,starts_at,audience)').order('taken_at',{ascending:false,nullsFirst:false}),
      isAdmin ? supabase.from('events').select('id,title,description,location,starts_at,audience').order('starts_at',{ascending:false}) : Promise.resolve({data:[],error:null}),
    ])
    if(galleryResult.error)setError(galleryResult.error.message)
    if(eventsResult.error)setError(eventsResult.error.message)
    const resolved=await Promise.all((galleryResult.data||[]).map(async item=>({...item,display_url:await resolvePrivateMedia(item,{entity:'gallery',fallbackBucket:'gallery'})})))
    setItems(resolved);setEvents(eventsResult.data||[]);setLoading(false)
  }

  useEffect(()=>{load()},[isAdmin])
  useEffect(()=>{if(selectedEventId)setUploadEventId(selectedEventId)},[selectedEventId])
  useEffect(()=>{if(isAdmin)getR2Status().then(setR2Ready)},[isAdmin])

  const albums=useMemo(()=>{
    const map=new Map()
    items.forEach(item=>{
      const key=item.event_id||'other'
      if(!map.has(key))map.set(key,{id:key,event:item.event||null,title:item.event?.title||(item.event_id?'Événement':'Autres souvenirs'),date:item.event?.starts_at||null,media:[]})
      map.get(key).media.push(item)
    })
    return [...map.values()].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))
  },[items])

  const selectedAlbum=useMemo(()=>{
    const existing=albums.find(album=>album.id===selectedEventId)
    if(existing)return existing
    if(isAdmin&&selectedEventId){const event=events.find(e=>e.id===selectedEventId);if(event)return{id:event.id,event,title:event.title,date:event.starts_at,media:[]}}
    return null
  },[albums,events,isAdmin,selectedEventId])

  const validateFile=file=>{if(!ACCEPTED_TYPES.has(file.type))throw new Error(`Format non pris en charge : ${file.name}.`);const isVideo=file.type.startsWith('video/'),limit=isVideo?VIDEO_LIMIT:IMAGE_LIMIT;if(file.size>limit)throw new Error(`${file.name} est trop volumineux. Maximum : ${isVideo?'200 Mo pour une vidéo':'20 Mo pour une photo'}.`)}

  const uploadMedia=async(e)=>{
    e.preventDefault();if(!uploadEventId)return setError('Choisissez l’événement de cet album.');if(!files.length)return setError('Choisissez au moins une photo ou vidéo.')
    const linkedEvent=events.find(item=>item.id===uploadEventId);if(!linkedEvent)return setError('Événement introuvable.')
    setUploading(true);setError('');setSuccess('');const inserted=[]
    try{
      files.forEach(validateFile);const now=new Date().toISOString()
      for(let index=0;index<files.length;index+=1){const file=files[index],mediaType=file.type.startsWith('video/')?'video':'image';const stored=await uploadPrivateMedia(file,{scope:'gallery',parentId:uploadEventId,fallbackBucket:'gallery'});const {data:row,error:insertError}=await supabase.from('gallery').insert({title:files.length===1&&caption.trim()?caption.trim():null,event_id:uploadEventId,media_type:mediaType,mime_type:file.type,file_size:file.size,storage_provider:stored.storage_provider,storage_path:stored.storage_path,image_url:null,taken_at:linkedEvent.starts_at?linkedEvent.starts_at.slice(0,10):null,audience:linkedEvent.audience||'everyone',publish_at:now,notified_at:index===0?null:now,created_by:user.id}).select('id,storage_provider,storage_path').single();if(insertError){await removePrivateMedia({...stored},{fallbackBucket:'gallery'});throw insertError}inserted.push(row)}
      setSuccess(`${files.length} média${files.length>1?'s':''} ajouté${files.length>1?'s':''} à l’album « ${linkedEvent.title} »${r2Ready?' sur R2':''}.`);setFiles([]);setCaption('');const input=document.getElementById('gallery-media-files');if(input)input.value='';setSearchParams({event:uploadEventId});await load()
    }catch(err){for(const item of inserted){await removePrivateMedia(item,{entity:'gallery',fallbackBucket:'gallery'});await supabase.from('gallery').delete().eq('id',item.id)}setError(err.message||'Impossible d’ajouter ces médias.')}finally{setUploading(false)}
  }

  const deleteMedia=async item=>{if(!window.confirm('Supprimer définitivement ce média ?'))return;setError('');await removePrivateMedia(item,{entity:'gallery',fallbackBucket:'gallery'});const {error:deleteError}=await supabase.from('gallery').delete().eq('id',item.id);if(deleteError)return setError(deleteError.message);await load()}
  const openAlbum=id=>setSearchParams(id==='other'?{}:{event:id})

  return <>
    <PageTitle eyebrow="Souvenirs" title="Galerie" text="Des albums photos et vidéos organisés par événement. Ouvrez un album pour retrouver tous les souvenirs du rendez-vous." />

    {isAdmin&&<section className="gallery-upload-panel"><div><span className="eyebrow">Administration</span><h2>Ajouter à un album</h2><p>Choisissez l’événement : ses photos et vidéos seront regroupées automatiquement dans le même album.</p><div className="privacy-note">{r2Ready?'☁️ Cloudflare R2 connecté : les nouveaux médias utilisent le stockage R2.':'☁️ R2 non détecté : stockage Supabase de secours.'}</div></div><form onSubmit={uploadMedia}><label>Album / événement<select required value={uploadEventId} onChange={e=>setUploadEventId(e.target.value)}><option value="">Choisir un événement…</option>{events.map(event=><option key={event.id} value={event.id}>{formatDate(event.starts_at)} — {event.title}</option>)}</select></label><label>Photos / vidéos<input id="gallery-media-files" type="file" multiple required accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={e=>setFiles([...e.target.files])}/></label>{files.length===1&&<label>Légende (facultatif)<input maxLength="160" value={caption} onChange={e=>setCaption(e.target.value)}/></label>}<div className="gallery-upload-limits">Photos : 20 Mo max • Vidéos : 200 Mo max avec R2</div><button className="primary-button" disabled={uploading}>{uploading?'Envoi en cours…':`Ajouter ${files.length||''} média${files.length>1?'s':''}`}</button></form></section>}

    {error&&<div className="alert error" style={{marginBottom:'1rem'}}>{error}</div>}{success&&<div className="alert" style={{marginBottom:'1rem'}}>{success}</div>}

    {loading?<div className="skeleton-card tall"/>:selectedAlbum?<>
      <div className="gallery-album-heading"><button type="button" className="secondary-button" onClick={()=>setSearchParams({})}>← Tous les albums</button><div><span className="eyebrow">Album événement</span><h2>{selectedAlbum.title}</h2>{selectedAlbum.date&&<p>{formatDate(selectedAlbum.date)} · {selectedAlbum.media.length} média{selectedAlbum.media.length>1?'s':''}</p>}{selectedAlbum.event?.location&&<p>📍 {selectedAlbum.event.location}</p>}{selectedAlbum.event?.description&&<p className="gallery-album-description">{selectedAlbum.event.description}</p>}</div></div>
      {selectedAlbum.media.length?<div className="gallery-media-grid">{selectedAlbum.media.map(item=><figure className="gallery-media-item" key={item.id}>{item.display_url?(item.media_type==='video'?<video src={item.display_url} controls playsInline preload="metadata"/>:<img src={item.display_url} alt={item.title||`Photo de ${selectedAlbum.title}`} loading="lazy"/>):<div className="empty-state">Média indisponible</div>}<figcaption><div>{item.title&&<strong>{item.title}</strong>}{item.taken_at&&<span>{formatDate(item.taken_at)}</span>}</div>{isAdmin&&<button type="button" className="ghost-button" onClick={()=>deleteMedia(item)}>Supprimer</button>}</figcaption></figure>)}</div>:<div className="empty-state">Cet album ne contient encore aucun média.</div>}
    </>:albums.length?<div className="gallery-album-grid">{albums.map(album=>{const cover=album.media.find(item=>item.media_type!=='video'&&item.display_url)||album.media[0];return <button type="button" className="gallery-album-card" key={album.id} onClick={()=>openAlbum(album.id)}><div className="gallery-album-cover">{cover?.display_url&&cover.media_type!=='video'?<img src={cover.display_url} alt="" loading="lazy"/>:<span>🎬</span>}<div className="gallery-album-count">{album.media.length} média{album.media.length>1?'s':''}</div></div><div className="gallery-album-info"><strong>{album.title}</strong>{album.date&&<span>{formatDate(album.date)}</span>}<small>Ouvrir l’album →</small></div></button>})}</div>:<div className="empty-state">Aucun album partagé pour votre profil.</div>}
  </>
}
