import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getR2Status, optimizeImageFile, removePrivateMedia, resolvePrivateMediaBatch, uploadPrivateMedia } from '../lib/mediaStorage.js'
import { PageTitle } from './Actualites.jsx'
import '../gallery-events.css'

const IMAGE_LIMIT = 30 * 1024 * 1024
const VIDEO_LIMIT = 200 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
const formatDate = (value) => value ? new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}) : ''

export default function Galerie(){
  const { user, isAdmin } = useAuth()
  const location=useLocation()
  const adminMode=isAdmin&&location.pathname.startsWith('/administration/galerie')
  const [searchParams,setSearchParams]=useSearchParams()
  const selectedEventId=searchParams.get('event')||''
  const [items,setItems]=useState([])
  const [events,setEvents]=useState([])
  const [albumCovers,setAlbumCovers]=useState({})
  const [albumMedia,setAlbumMedia]=useState([])
  const [loading,setLoading]=useState(true)
  const [loadingAlbum,setLoadingAlbum]=useState(false)
  const [uploadEventId,setUploadEventId]=useState(selectedEventId)
  const [files,setFiles]=useState([])
  const [caption,setCaption]=useState('')
  const [uploading,setUploading]=useState(false)
  const [uploadProgress,setUploadProgress]=useState('')
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')
  const [r2Ready,setR2Ready]=useState(false)
  const [viewerIndex,setViewerIndex]=useState(null)

  const load=async()=>{
    setLoading(true);setError('')
    const [galleryResult,eventsResult]=await Promise.all([
      supabase.from('gallery').select('id,event_id,media_type,mime_type,file_size,storage_provider,storage_path,image_url,title,taken_at,created_at,event:events(id,title,description,location,starts_at,audience)').order('created_at',{ascending:false}),
      adminMode ? supabase.from('events').select('id,title,description,location,starts_at,audience').order('starts_at',{ascending:false}) : Promise.resolve({data:[],error:null}),
    ])
    if(galleryResult.error)setError(galleryResult.error.message)
    if(eventsResult.error)setError(eventsResult.error.message)
    const rows=galleryResult.data||[]
    setItems(rows);setEvents(eventsResult.data||[])

    const coverByEvent=new Map()
    for(const item of rows){
      const key=item.event_id||'other'
      if(item.media_type==='image'&&!coverByEvent.has(key))coverByEvent.set(key,item)
    }
    const candidates=[...coverByEvent.values()]
    const urls=await resolvePrivateMediaBatch(candidates,{entity:'gallery',fallbackBucket:'gallery'})
    const covers={}
    for(const item of candidates){const url=urls.get(item.id);if(url)covers[item.event_id||'other']=url}
    setAlbumCovers(covers)
    setLoading(false)
  }

  useEffect(()=>{load()},[adminMode])
  useEffect(()=>{if(selectedEventId)setUploadEventId(selectedEventId);setViewerIndex(null)},[selectedEventId])
  useEffect(()=>{if(adminMode)getR2Status().then(setR2Ready)},[adminMode])

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
    if(adminMode&&selectedEventId){const event=events.find(e=>e.id===selectedEventId);if(event)return{id:event.id,event,title:event.title,date:event.starts_at,media:[]}}
    return null
  },[albums,events,adminMode,selectedEventId])

  useEffect(()=>{
    let cancelled=false
    const resolveAlbum=async()=>{
      if(!selectedAlbum){setAlbumMedia([]);return}
      setLoadingAlbum(true)
      const urls=await resolvePrivateMediaBatch(selectedAlbum.media,{entity:'gallery',fallbackBucket:'gallery'})
      if(!cancelled)setAlbumMedia(selectedAlbum.media.map(item=>({...item,display_url:urls.get(item.id)||item.image_url||null})))
      if(!cancelled)setLoadingAlbum(false)
    }
    resolveAlbum()
    return()=>{cancelled=true}
  },[selectedAlbum?.id,items])

  useEffect(()=>{
    const onKey=(event)=>{
      if(viewerIndex===null)return
      if(event.key==='Escape')setViewerIndex(null)
      if(event.key==='ArrowLeft')setViewerIndex(index=>index===null?null:(index-1+albumMedia.length)%albumMedia.length)
      if(event.key==='ArrowRight')setViewerIndex(index=>index===null?null:(index+1)%albumMedia.length)
    }
    window.addEventListener('keydown',onKey)
    return()=>window.removeEventListener('keydown',onKey)
  },[viewerIndex,albumMedia.length])

  const validateFile=file=>{if(!ACCEPTED_TYPES.has(file.type))throw new Error(`Format non pris en charge : ${file.name}.`);const isVideo=file.type.startsWith('video/'),limit=isVideo?VIDEO_LIMIT:IMAGE_LIMIT;if(file.size>limit)throw new Error(`${file.name} est trop volumineux. Maximum avant optimisation : ${isVideo?'200 Mo pour une vidéo':'30 Mo pour une photo'}.`)}

  const uploadMedia=async(e)=>{
    e.preventDefault();if(!uploadEventId)return setError('Choisissez l’événement de cet album.');if(!files.length)return setError('Choisissez au moins une photo ou vidéo.')
    const linkedEvent=events.find(item=>item.id===uploadEventId);if(!linkedEvent)return setError('Événement introuvable.')
    setUploading(true);setError('');setSuccess('');const inserted=[]
    try{
      files.forEach(validateFile);const now=new Date().toISOString()
      for(let index=0;index<files.length;index+=1){
        setUploadProgress(`Préparation ${index+1}/${files.length}…`)
        const original=files[index],mediaType=original.type.startsWith('video/')?'video':'image'
        const file=mediaType==='image'?await optimizeImageFile(original):original
        setUploadProgress(`Envoi ${index+1}/${files.length}…`)
        const stored=await uploadPrivateMedia(file,{scope:'gallery',parentId:uploadEventId,fallbackBucket:'gallery'})
        const {data:row,error:insertError}=await supabase.from('gallery').insert({title:files.length===1&&caption.trim()?caption.trim():null,event_id:uploadEventId,media_type:mediaType,mime_type:file.type,file_size:file.size,storage_provider:stored.storage_provider,storage_path:stored.storage_path,image_url:null,taken_at:linkedEvent.starts_at?linkedEvent.starts_at.slice(0,10):null,audience:linkedEvent.audience||'everyone',publish_at:now,notified_at:index===0?null:now,created_by:user.id}).select('id,storage_provider,storage_path').single()
        if(insertError){await removePrivateMedia({...stored},{fallbackBucket:'gallery'});throw insertError}
        inserted.push(row)
      }
      setSuccess(`${files.length} média${files.length>1?'s':''} ajouté${files.length>1?'s':''} à l’album « ${linkedEvent.title} ». Les photos ont été optimisées automatiquement.`)
      setFiles([]);setCaption('');setUploadProgress('');const input=document.getElementById('gallery-media-files');if(input)input.value='';setSearchParams({event:uploadEventId});await load()
    }catch(err){for(const item of inserted){await removePrivateMedia(item,{entity:'gallery',fallbackBucket:'gallery'});await supabase.from('gallery').delete().eq('id',item.id)}setError(err.message||'Impossible d’ajouter ces médias.')}finally{setUploading(false);setUploadProgress('')}
  }

  const deleteMedia=async(item)=>{if(!window.confirm('Supprimer définitivement ce média ?'))return;setError('');await removePrivateMedia(item,{entity:'gallery',fallbackBucket:'gallery'});const {error:deleteError}=await supabase.from('gallery').delete().eq('id',item.id);if(deleteError)return setError(deleteError.message);setViewerIndex(null);await load()}
  const openAlbum=id=>setSearchParams(id==='other'?{}:{event:id})
  const activeMedia=viewerIndex===null?null:albumMedia[viewerIndex]

  return <>
    <PageTitle eyebrow="Souvenirs" title={adminMode?'Albums & médias':'Galerie'} text={adminMode?'Ajoutez des photos et vidéos à n’importe quel événement existant. Les photos sont optimisées automatiquement avant stockage.':'Ouvrez un album : seules ses photos et vidéos seront alors chargées, pour une navigation plus rapide.'} />

    {adminMode&&<><div style={{marginBottom:'1rem'}}><Link className="ghost-button" to="/administration">← Administration</Link></div><section className="gallery-upload-panel"><div><span className="eyebrow">Administration</span><h2>Ajouter à un album</h2><p>Sélectionnez un événement, même ancien. Les médias rejoindront automatiquement son album.</p><div className="privacy-note">{r2Ready?'☁️ Cloudflare R2 connecté.':'☁️ R2 non détecté : stockage Supabase de secours.'}</div></div><form onSubmit={uploadMedia}><label>Album / événement<select required value={uploadEventId} onChange={e=>setUploadEventId(e.target.value)}><option value="">Choisir un événement…</option>{events.map(event=><option key={event.id} value={event.id}>{formatDate(event.starts_at)} — {event.title}</option>)}</select></label><label>Photos / vidéos<input id="gallery-media-files" type="file" multiple required accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={e=>setFiles([...e.target.files])}/></label>{files.length===1&&<label>Légende (facultatif)<input maxLength="160" value={caption} onChange={e=>setCaption(e.target.value)}/></label>}<div className="gallery-upload-limits">Photos optimisées automatiquement jusqu’à 1920 px • Vidéos : 200 Mo max</div><button className="primary-button" disabled={uploading}>{uploading?(uploadProgress||'Envoi en cours…'):`Ajouter ${files.length||''} média${files.length>1?'s':''}`}</button></form></section></>}

    {error&&<div className="alert error" style={{marginBottom:'1rem'}}>{error}</div>}{success&&<div className="alert" style={{marginBottom:'1rem'}}>{success}</div>}

    {loading?<div className="skeleton-card tall"/>:selectedAlbum?<>
      <div className="gallery-album-heading"><button type="button" className="secondary-button" onClick={()=>setSearchParams({})}>← Tous les albums</button><div><span className="eyebrow">Album événement</span><h2>{selectedAlbum.title}</h2>{selectedAlbum.date&&<p>{formatDate(selectedAlbum.date)} · {selectedAlbum.media.length} média{selectedAlbum.media.length>1?'s':''}</p>}{selectedAlbum.event?.location&&<p>📍 {selectedAlbum.event.location}</p>}{selectedAlbum.event?.description&&<p className="gallery-album-description">{selectedAlbum.event.description}</p>}</div></div>
      {loadingAlbum?<div className="gallery-loading"><span className="gallery-spinner"/>Chargement de l’album…</div>:albumMedia.length?<div className="gallery-media-grid">{albumMedia.map((item,index)=><figure className="gallery-media-item" key={item.id}><button type="button" className="gallery-media-open" onClick={()=>setViewerIndex(index)} aria-label={`Ouvrir ${item.media_type==='video'?'la vidéo':'la photo'} ${index+1}`}>{item.display_url?(item.media_type==='video'?<div className="gallery-video-thumb"><span>▶</span><strong>Vidéo</strong></div>:<img src={item.display_url} alt={item.title||`Photo de ${selectedAlbum.title}`} loading="lazy" decoding="async"/>):<div className="gallery-media-missing">Média indisponible</div>}</button><figcaption><div>{item.title&&<strong>{item.title}</strong>}{item.taken_at&&<span>{formatDate(item.taken_at)}</span>}</div>{adminMode&&<button type="button" className="ghost-button" onClick={()=>deleteMedia(item)}>Supprimer</button>}</figcaption></figure>)}</div>:<div className="empty-state">Cet album ne contient encore aucun média.</div>}
    </>:albums.length?<div className="gallery-album-grid">{albums.map(album=><button type="button" className="gallery-album-card" key={album.id} onClick={()=>openAlbum(album.id)}><div className="gallery-album-cover">{albumCovers[album.id]?<img src={albumCovers[album.id]} alt="" loading="lazy" decoding="async"/>:<span>{album.media.some(item=>item.media_type==='video')?'🎬':'📷'}</span>}<div className="gallery-album-count">{album.media.length} média{album.media.length>1?'s':''}</div></div><div className="gallery-album-info"><strong>{album.title}</strong>{album.date&&<span>{formatDate(album.date)}</span>}<small>Ouvrir l’album →</small></div></button>)}</div>:<div className="empty-state">Aucun album partagé pour votre profil.</div>}

    {activeMedia&&<div className="gallery-viewer-backdrop" onClick={()=>setViewerIndex(null)} role="presentation"><section className="gallery-viewer" role="dialog" aria-modal="true" aria-label={`${activeMedia.media_type==='video'?'Vidéo':'Photo'} ${viewerIndex+1} sur ${albumMedia.length}`} onClick={e=>e.stopPropagation()}><button className="gallery-viewer-close" type="button" aria-label="Fermer" onClick={()=>setViewerIndex(null)}>×</button><div className="gallery-viewer-stage">{activeMedia.media_type==='video'?<video key={activeMedia.id} src={activeMedia.display_url} controls autoPlay playsInline preload="metadata"/>:<img src={activeMedia.display_url} alt={activeMedia.title||selectedAlbum?.title||'Photo'} decoding="async"/>}</div>{albumMedia.length>1&&<><button className="gallery-viewer-nav prev" type="button" aria-label="Média précédent" onClick={()=>setViewerIndex((viewerIndex-1+albumMedia.length)%albumMedia.length)}>‹</button><button className="gallery-viewer-nav next" type="button" aria-label="Média suivant" onClick={()=>setViewerIndex((viewerIndex+1)%albumMedia.length)}>›</button></>}<footer className="gallery-viewer-footer"><span>{viewerIndex+1} / {albumMedia.length}</span>{activeMedia.title&&<strong>{activeMedia.title}</strong>}</footer></section></div>}
  </>
}
