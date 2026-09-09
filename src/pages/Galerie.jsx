import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { optimizeImageFile, removePrivateMedia, resolvePrivateMediaBatch, uploadPrivateMedia } from '../lib/mediaStorage.js'
import { PageTitle } from './Actualites.jsx'
import '../gallery-events.css'

const IMAGE_LIMIT = 30 * 1024 * 1024
const formatDate = (value) => value ? new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}) : ''
const expiryValue = (value) => value ? new Date(value).toISOString().slice(0,10) : ''

export default function Galerie(){
  const { user, isAdmin } = useAuth()
  const location = useLocation()
  const adminMode = isAdmin && location.pathname.startsWith('/administration/galerie')
  const [searchParams,setSearchParams] = useSearchParams()
  const selectedEventId = searchParams.get('event') || ''
  const [albums,setAlbums] = useState([])
  const [events,setEvents] = useState([])
  const [coverUrls,setCoverUrls] = useState(new Map())
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  const [success,setSuccess] = useState('')
  const [editEventId,setEditEventId] = useState(selectedEventId)
  const [coverFile,setCoverFile] = useState(null)
  const [transferUrl,setTransferUrl] = useState('')
  const [expiresAt,setExpiresAt] = useState('')
  const [itemCount,setItemCount] = useState('')
  const [downloadNote,setDownloadNote] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    const [albumsResult,eventsResult] = await Promise.all([
      supabase.from('event_albums').select('id,event_id,storage_provider,storage_path,image_url,mime_type,file_size,source_gallery_id,transfer_provider,transfer_url,transfer_expires_at,item_count,download_note,updated_at,event:events(id,title,description,location,starts_at,audience)').order('updated_at',{ascending:false}),
      adminMode ? supabase.from('events').select('id,title,description,location,starts_at,audience').order('starts_at',{ascending:false}) : Promise.resolve({data:[],error:null}),
    ])
    if(albumsResult.error)setError(albumsResult.error.message)
    if(eventsResult.error)setError(eventsResult.error.message)
    const rows = albumsResult.data || []
    const urls = await resolvePrivateMediaBatch(rows,{entity:'album',fallbackBucket:'gallery'})
    setAlbums(rows)
    setEvents(eventsResult.data || [])
    setCoverUrls(urls)
    setLoading(false)
  }

  useEffect(()=>{load()},[adminMode])
  useEffect(()=>{if(selectedEventId)setEditEventId(selectedEventId)},[selectedEventId])

  const selectedAlbum = useMemo(()=>albums.find(album=>album.event_id===selectedEventId)||null,[albums,selectedEventId])
  const editingAlbum = useMemo(()=>albums.find(album=>album.event_id===editEventId)||null,[albums,editEventId])

  useEffect(()=>{
    if(!adminMode)return
    setCoverFile(null)
    setTransferUrl(editingAlbum?.transfer_url || '')
    setExpiresAt(expiryValue(editingAlbum?.transfer_expires_at))
    setItemCount(editingAlbum?.item_count == null ? '' : String(editingAlbum.item_count))
    setDownloadNote(editingAlbum?.download_note || '')
  },[adminMode,editEventId,editingAlbum?.id])

  const isExpired = album => Boolean(album?.transfer_expires_at && new Date(album.transfer_expires_at).getTime() < Date.now())
  const coverFor = album => coverUrls.get(album.id) || album.image_url || null

  const saveAlbum = async (event) => {
    event.preventDefault()
    if(!editEventId)return setError('Choisissez un événement.')
    if(!editingAlbum && !coverFile)return setError('Ajoutez une photo de miniature pour ce nouvel album.')
    if(coverFile && (!coverFile.type.startsWith('image/') || coverFile.size > IMAGE_LIMIT))return setError('La miniature doit être une image de 30 Mo maximum avant optimisation.')
    if(transferUrl && !/^https:\/\//i.test(transferUrl.trim()))return setError('Le lien de téléchargement doit commencer par https://')

    setSaving(true); setError(''); setSuccess('')
    let uploaded = null
    try{
      const payload = {
        event_id: editEventId,
        transfer_provider: 'wetransfer',
        transfer_url: transferUrl.trim() || null,
        transfer_expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
        item_count: itemCount === '' ? null : Math.max(0,Number.parseInt(itemCount,10)||0),
        download_note: downloadNote.trim() || null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }
      if(!editingAlbum)payload.created_by=user.id

      if(coverFile){
        const optimized = await optimizeImageFile(coverFile,{maxDimension:1280,quality:.8})
        uploaded = await uploadPrivateMedia(optimized,{scope:'gallery',parentId:editEventId,fallbackBucket:'gallery'})
        Object.assign(payload,{
          storage_provider:uploaded.storage_provider,
          storage_path:uploaded.storage_path,
          image_url:null,
          mime_type:optimized.type,
          file_size:optimized.size,
          source_gallery_id:null,
        })
      }

      const {error:upsertError} = await supabase.from('event_albums').upsert(payload,{onConflict:'event_id'})
      if(upsertError)throw upsertError

      if(coverFile && editingAlbum?.storage_path && editingAlbum.source_gallery_id == null){
        await removePrivateMedia(editingAlbum,{fallbackBucket:'gallery'})
      }

      setCoverFile(null)
      const input=document.getElementById('album-cover-file'); if(input)input.value=''
      setSuccess('Album enregistré. Le site ne stocke que sa miniature ; le téléchargement complet reste externe.')
      setSearchParams({event:editEventId})
      await load()
    }catch(err){
      if(uploaded)await removePrivateMedia(uploaded,{fallbackBucket:'gallery'})
      setError(err.message||'Impossible d’enregistrer cet album.')
    }finally{setSaving(false)}
  }

  const deleteAlbum = async album => {
    if(!window.confirm(`Retirer l’album « ${album.event?.title||'sans titre'} » du site ? Le transfert WeTransfer ne sera pas supprimé.`))return
    setError(''); setSuccess('')
    try{
      if(album.storage_path && album.source_gallery_id == null)await removePrivateMedia(album,{fallbackBucket:'gallery'})
      const {error:deleteError}=await supabase.from('event_albums').delete().eq('id',album.id)
      if(deleteError)throw deleteError
      setSearchParams({}); if(editEventId===album.event_id)setEditEventId('')
      setSuccess('Album retiré du site. Le lien externe WeTransfer reste géré dans votre compte WeTransfer.')
      await load()
    }catch(err){setError(err.message||'Suppression impossible.')}
  }

  return <>
    <PageTitle eyebrow="Souvenirs" title={adminMode?'Albums & téléchargements':'Galerie'} text={adminMode?'Une seule miniature est stockée sur le site. Les albums complets restent sur WeTransfer ou un autre service externe de téléchargement.':'La galerie reste légère : une miniature par événement, puis le téléchargement complet s’ouvre uniquement à votre demande.'} />

    {adminMode&&<>
      <div style={{marginBottom:'1rem'}}><Link className="ghost-button" to="/administration">← Administration</Link></div>
      <section className="gallery-upload-panel light-album-admin">
        <div>
          <span className="eyebrow">Administration</span><h2>Album léger</h2>
          <p>1. Créez votre transfert complet sur WeTransfer. 2. Copiez le lien. 3. Ajoutez ici uniquement une miniature et ce lien.</p>
          <div className="privacy-note"><strong>Photos privées :</strong> protégez de préférence le transfert par mot de passe ou restriction d’e-mail et transmettez le mot de passe séparément. Ne l’enregistrez pas dans le site.</div>
          <a className="secondary-button external-album-link" href="https://wetransfer.com/" target="_blank" rel="noopener noreferrer">Ouvrir WeTransfer ↗</a>
        </div>
        <form onSubmit={saveAlbum}>
          <label>Événement<select required value={editEventId} onChange={e=>setEditEventId(e.target.value)}><option value="">Choisir un événement…</option>{events.map(item=><option key={item.id} value={item.id}>{formatDate(item.starts_at)} — {item.title}</option>)}</select></label>
          <label>Miniature {editingAlbum?'(laisser vide pour conserver l’actuelle)':'(obligatoire)'}<input id="album-cover-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setCoverFile(e.target.files?.[0]||null)}/></label>
          {editingAlbum&&coverFor(editingAlbum)&&<img className="album-admin-current-cover" src={coverFor(editingAlbum)} alt="Miniature actuelle"/>}
          <label>Lien WeTransfer<input type="url" placeholder="https://we.tl/..." value={transferUrl} onChange={e=>setTransferUrl(e.target.value)}/></label>
          <div className="album-admin-two"><label>Expiration du lien<input type="date" value={expiresAt} onChange={e=>setExpiresAt(e.target.value)}/></label><label>Nombre de médias (facultatif)<input type="number" min="0" inputMode="numeric" value={itemCount} onChange={e=>setItemCount(e.target.value)}/></label></div>
          <label>Information pour les membres (facultatif)<input maxLength="180" placeholder="Ex. Mot de passe transmis séparément" value={downloadNote} onChange={e=>setDownloadNote(e.target.value)}/></label>
          <div className="gallery-upload-limits">La miniature est automatiquement réduite à 1280 px. Aucune vidéo ni album complet n’est envoyé vers notre serveur.</div>
          <button className="primary-button" disabled={saving}>{saving?'Enregistrement…':editingAlbum?'Mettre à jour l’album':'Créer l’album'}</button>
          {editingAlbum&&<button type="button" className="ghost-button danger-action" onClick={()=>deleteAlbum(editingAlbum)} disabled={saving}>Retirer cet album du site</button>}
        </form>
      </section>
    </>}

    {error&&<div className="alert error" style={{marginBottom:'1rem'}}>{error}</div>}{success&&<div className="alert" style={{marginBottom:'1rem'}}>{success}</div>}

    {loading?<div className="skeleton-card tall"/>:selectedAlbum?<section className="light-album-detail">
      <button type="button" className="secondary-button" onClick={()=>setSearchParams({})}>← Tous les albums</button>
      <div className="light-album-hero">
        <div className="light-album-cover">{coverFor(selectedAlbum)?<img src={coverFor(selectedAlbum)} alt=""/>:<span>📷</span>}</div>
        <div className="light-album-copy"><span className="eyebrow">Album événement</span><h2>{selectedAlbum.event?.title||'Album'}</h2>{selectedAlbum.event?.starts_at&&<p>📅 {formatDate(selectedAlbum.event.starts_at)}</p>}{selectedAlbum.event?.location&&<p>📍 {selectedAlbum.event.location}</p>}{selectedAlbum.item_count!=null&&<p>📷 {selectedAlbum.item_count} média{selectedAlbum.item_count>1?'s':''}</p>}{selectedAlbum.event?.description&&<p className="gallery-album-description">{selectedAlbum.event.description}</p>}
          {selectedAlbum.download_note&&<div className="privacy-note">{selectedAlbum.download_note}</div>}
          {selectedAlbum.transfer_url ? isExpired(selectedAlbum) ? <div className="alert warning"><strong>Lien arrivé à expiration.</strong><br/>L’administrateur doit renouveler le transfert avant le téléchargement.</div> : <><a className="primary-button album-download-button" href={selectedAlbum.transfer_url} target="_blank" rel="noopener noreferrer">Télécharger l’album complet ↗</a>{selectedAlbum.transfer_expires_at&&<small className="album-expiry">Disponible jusqu’au {formatDate(selectedAlbum.transfer_expires_at)}</small>}</> : <div className="empty-state compact-empty">Le téléchargement complet de cet album n’est pas encore publié.</div>}
        </div>
      </div>
    </section>:albums.length?<div className="gallery-album-grid">{albums.map(album=><button type="button" className="gallery-album-card" key={album.id} onClick={()=>setSearchParams({event:album.event_id})}><div className="gallery-album-cover">{coverFor(album)?<img src={coverFor(album)} alt="" loading="lazy" decoding="async"/>:<span>📷</span>}<div className="gallery-album-count">{album.item_count!=null?`${album.item_count} média${album.item_count>1?'s':''}`:'Album'}</div>{album.transfer_url&&isExpired(album)&&<div className="album-expired-badge">Lien expiré</div>}</div><div className="gallery-album-info"><strong>{album.event?.title||'Album'}</strong>{album.event?.starts_at&&<span>{formatDate(album.event.starts_at)}</span>}<small>{album.transfer_url&&!isExpired(album)?'Téléchargement disponible →':'Voir l’album →'}</small></div></button>)}</div>:<div className="empty-state">Aucun album partagé pour votre profil.</div>}
  </>
}
