import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getR2Status, removePrivateMedia, resolvePrivateMedia, uploadPrivateMedia } from '../lib/mediaStorage.js'
import { PageTitle } from './Actualites.jsx'
import '../gallery-events.css'

const IMAGE_LIMIT = 20 * 1024 * 1024
const VIDEO_LIMIT = 200 * 1024 * 1024
const ACCEPTED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
])

const formatDate = (value) => value
  ? new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  : ''

export default function Galerie(){
  const { user, isAdmin } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedEventId = searchParams.get('event') || ''
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

  const load = async () => {
    setLoading(true)
    const [galleryResult, eventsResult] = await Promise.all([
      supabase.from('gallery').select('*, event:events(id,title,starts_at,audience)').order('taken_at',{ascending:false,nullsFirst:false}),
      isAdmin
        ? supabase.from('events').select('id,title,starts_at,audience').order('starts_at',{ascending:false})
        : Promise.resolve({ data: [], error: null }),
    ])

    if (galleryResult.error) setError(galleryResult.error.message)
    if (eventsResult.error) setError(eventsResult.error.message)

    const rows = galleryResult.data || []
    const resolved=await Promise.all(rows.map(async(item)=>({
      ...item,
      display_url: await resolvePrivateMedia(item,{entity:'gallery',fallbackBucket:'gallery'}),
    })))
    setItems(resolved)
    setEvents(eventsResult.data || [])
    setLoading(false)
  }

  useEffect(()=>{ load() },[isAdmin])
  useEffect(()=>{ if(selectedEventId) setUploadEventId(selectedEventId) },[selectedEventId])
  useEffect(()=>{ if(isAdmin) getR2Status().then(setR2Ready) },[isAdmin])

  const folders = useMemo(() => {
    const map = new Map()
    items.forEach((item) => {
      const key = item.event_id || 'other'
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          event: item.event || null,
          title: item.event?.title || (item.event_id ? 'Événement' : 'Autres souvenirs'),
          date: item.event?.starts_at || null,
          media: [],
        })
      }
      map.get(key).media.push(item)
    })
    return [...map.values()].sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0))
  }, [items])

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedEventId) || null,
    [folders, selectedEventId],
  )

  const validateFile = (file) => {
    if (!ACCEPTED_TYPES.has(file.type)) throw new Error(`Format non pris en charge : ${file.name}. Utilisez JPG, PNG, WEBP, GIF, MP4, MOV ou WEBM.`)
    const isVideo = file.type.startsWith('video/')
    const limit = isVideo ? VIDEO_LIMIT : IMAGE_LIMIT
    if (file.size > limit) throw new Error(`${file.name} est trop volumineux. Maximum : ${isVideo ? '200 Mo pour une vidéo' : '20 Mo pour une photo'}.`)
  }

  const uploadMedia = async (event) => {
    event.preventDefault()
    if (!uploadEventId) return setError('Choisissez l’événement auquel rattacher ces médias.')
    if (!files.length) return setError('Choisissez au moins une photo ou vidéo.')
    const linkedEvent = events.find((item) => item.id === uploadEventId)
    if (!linkedEvent) return setError('Événement introuvable.')

    setUploading(true)
    setError('')
    setSuccess('')
    const inserted=[]
    try {
      files.forEach(validateFile)
      const now = new Date().toISOString()

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const mediaType = file.type.startsWith('video/') ? 'video' : 'image'
        const stored=await uploadPrivateMedia(file,{scope:'gallery',parentId:uploadEventId,fallbackBucket:'gallery'})
        const { data: row, error: insertError } = await supabase.from('gallery').insert({
          title: files.length === 1 && caption.trim() ? caption.trim() : null,
          event_id: uploadEventId,
          media_type: mediaType,
          mime_type: file.type,
          file_size: file.size,
          storage_provider: stored.storage_provider,
          storage_path: stored.storage_path,
          image_url: null,
          taken_at: linkedEvent.starts_at ? linkedEvent.starts_at.slice(0,10) : null,
          audience: linkedEvent.audience || 'everyone',
          publish_at: now,
          notified_at: index === 0 ? null : now,
          created_by: user.id,
        }).select('id,storage_provider,storage_path').single()
        if (insertError) throw insertError
        inserted.push(row)
      }

      setSuccess(`${files.length} média${files.length > 1 ? 's' : ''} ajouté${files.length > 1 ? 's' : ''} au dossier « ${linkedEvent.title} »${r2Ready ? ' sur le stockage R2.' : '.'}`)
      setFiles([])
      setCaption('')
      const input = document.getElementById('gallery-media-files')
      if (input) input.value = ''
      setSearchParams({ event: uploadEventId })
      await load()
    } catch (err) {
      for (const item of inserted) {
        await removePrivateMedia(item,{fallbackBucket:'gallery'})
        await supabase.from('gallery').delete().eq('id',item.id)
      }
      setError(err.message || 'Impossible d’ajouter ces médias.')
    } finally {
      setUploading(false)
    }
  }

  const deleteMedia = async (item) => {
    if (!window.confirm('Supprimer définitivement ce média ?')) return
    setError('')
    await removePrivateMedia(item,{fallbackBucket:'gallery'})
    const { error: deleteError } = await supabase.from('gallery').delete().eq('id', item.id)
    if (deleteError) return setError(deleteError.message)
    await load()
  }

  const openFolder = (id) => setSearchParams(id === 'other' ? {} : { event: id })

  return <>
    <PageTitle eyebrow="Souvenirs" title="Galerie" text="Photos et vidéos classées par événement. Chaque dossier rassemble les souvenirs liés au rendez-vous correspondant." />

    {isAdmin && <section className="gallery-upload-panel">
      <div>
        <span className="eyebrow">Administration</span>
        <h2>Ajouter des photos ou vidéos</h2>
        <p>Choisissez l’événement : les fichiers seront rangés automatiquement dans son dossier privé.</p>
        <div className={`privacy-note ${r2Ready ? '' : 'warning'}`}>{r2Ready ? '☁️ Cloudflare R2 connecté : les nouveaux médias utilisent le stockage R2.' : '☁️ R2 pas encore raccordé : stockage Supabase de secours utilisé en attendant les clés Cloudflare.'}</div>
      </div>
      <form onSubmit={uploadMedia}>
        <label>Événement
          <select required value={uploadEventId} onChange={(e)=>setUploadEventId(e.target.value)}>
            <option value="">Choisir un événement…</option>
            {events.map((event)=><option key={event.id} value={event.id}>{formatDate(event.starts_at)} — {event.title}</option>)}
          </select>
        </label>
        <label>Photos / vidéos
          <input id="gallery-media-files" type="file" multiple required accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={(e)=>setFiles([...e.target.files])} />
        </label>
        {files.length === 1 && <label>Légende (facultatif)<input type="text" maxLength="160" value={caption} onChange={(e)=>setCaption(e.target.value)} /></label>}
        <div className="gallery-upload-limits">Photos : 20 Mo max • Vidéos : 200 Mo max avec R2 • Si R2 n’est pas encore connecté, le secours Supabase reste limité à 45 Mo.</div>
        <button className="primary-button" disabled={uploading}>{uploading ? 'Envoi en cours…' : `Ajouter ${files.length || ''} média${files.length > 1 ? 's' : ''}`}</button>
      </form>
    </section>}

    {error && <div className="alert error" style={{marginBottom:'1rem'}}>{error}</div>}
    {success && <div className="alert" style={{marginBottom:'1rem'}}>{success}</div>}

    {loading ? <div className="skeleton-card tall"/> : selectedFolder ? <>
      <div className="gallery-folder-heading">
        <button type="button" className="secondary-button" onClick={()=>setSearchParams({})}>← Tous les dossiers</button>
        <div><span className="eyebrow">Dossier événement</span><h2>{selectedFolder.title}</h2>{selectedFolder.date && <p>{formatDate(selectedFolder.date)} • {selectedFolder.media.length} média{selectedFolder.media.length > 1 ? 's' : ''}</p>}</div>
      </div>
      <div className="gallery-media-grid">
        {selectedFolder.media.map((item)=><figure className="gallery-media-item" key={item.id}>
          {item.display_url ? item.media_type === 'video'
            ? <video src={item.display_url} controls playsInline preload="metadata" />
            : <img src={item.display_url} alt={item.title||`Photo de ${selectedFolder.title}`} loading="lazy" />
            : <div className="empty-state">Média indisponible</div>}
          <figcaption><div>{item.title && <strong>{item.title}</strong>}{item.taken_at && <span>{formatDate(item.taken_at)}</span>}</div>{isAdmin && <button type="button" className="ghost-button" onClick={()=>deleteMedia(item)}>Supprimer</button>}</figcaption>
        </figure>)}
      </div>
    </> : <>
      {folders.length ? <div className="gallery-folder-grid">
        {folders.map((folder)=>{
          const cover = folder.media.find((item)=>item.media_type !== 'video' && item.display_url) || folder.media[0]
          return <button type="button" className="gallery-folder-card" key={folder.id} onClick={()=>openFolder(folder.id)}>
            <div className="gallery-folder-cover">{cover?.display_url && cover.media_type !== 'video' ? <img src={cover.display_url} alt="" loading="lazy" /> : <span>🎬</span>}<div className="gallery-folder-count">{folder.media.length} média{folder.media.length > 1 ? 's' : ''}</div></div>
            <div className="gallery-folder-info"><strong>{folder.title}</strong>{folder.date && <span>{formatDate(folder.date)}</span>}</div>
          </button>
        })}
      </div> : <div className="empty-state">Aucune photo ou vidéo partagée pour votre profil.</div>}
    </>}
  </>
}
