import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { optimizeImageFile, removePrivateMedia, resolvePrivateMediaBatch, uploadPrivateMedia } from '../lib/mediaStorage.js'
import { PageTitle } from './Actualites.jsx'
import '../gallery-events.css'
import '../admin-content-unified.css'

const IMAGE_LIMIT = 30 * 1024 * 1024
const formatDate = (value) => value ? new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}) : ''
const expiryValue = (value) => value ? new Date(value).toISOString().slice(0,10) : ''
const toLocalInput=(value)=>{if(!value)return'';const d=new Date(value);const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,16)}
const audienceLabels={everyone:'Tout le monde',military:'Militaires DANZ uniquement',amicaliste:'Amicalistes uniquement',admin:'Bureau / Admin uniquement'}
const stateForAlbum=(album)=>album?.published===false?'draft':album?.publish_at&&new Date(album.publish_at).getTime()>Date.now()?'scheduled':'published'
const stateLabel=(state)=>state==='draft'?'Brouillon':state==='scheduled'?'Programmé':'Publié'

export default function Galerie({forceAdminMode=false,embeddedAdmin=false}){
  const { user, isAdmin } = useAuth()
  const location = useLocation()
  const adminMode = isAdmin && (forceAdminMode || location.pathname.startsWith('/administration/galerie'))
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
  const [albumAudience,setAlbumAudience] = useState('everyone')
  const [publicationMode,setPublicationMode] = useState('published')
  const [publishAt,setPublishAt] = useState('')
  const [notifyOnPublish,setNotifyOnPublish] = useState(true)

  const load = async () => {
    setLoading(true); setError('')
    const [albumsResult,eventsResult] = await Promise.all([
      supabase.from('event_albums').select('id,event_id,storage_provider,storage_path,image_url,mime_type,file_size,source_gallery_id,transfer_provider,transfer_url,transfer_expires_at,item_count,download_note,updated_at,published,audience,publish_at,notified_at,notify_on_publish,event:events(id,title,description,location,starts_at,audience,published,publish_at)').order('publish_at',{ascending:false}),
      adminMode ? supabase.from('events').select('id,title,description,location,starts_at,audience,published,publish_at').order('starts_at',{ascending:false}) : Promise.resolve({data:[],error:null}),
    ])
    if(albumsResult.error)setError('Impossible de charger les albums pour le moment.')
    if(eventsResult.error)setError((current)=>current||'Impossible de charger la liste des événements.')
    const rows = albumsResult.data || []
    const urls = await resolvePrivateMediaBatch(rows,{entity:'album',fallbackBucket:'gallery'})
    setAlbums(rows); setEvents(eventsResult.data || []); setCoverUrls(urls); setLoading(false)
  }

  useEffect(()=>{load()},[adminMode])
  useEffect(()=>{if(selectedEventId)setEditEventId(selectedEventId)},[selectedEventId])
  useEffect(()=>{const onOnline=()=>load();window.addEventListener('online',onOnline);return()=>window.removeEventListener('online',onOnline)},[adminMode])

  const selectedAlbum = useMemo(()=>albums.find(album=>album.event_id===selectedEventId)||null,[albums,selectedEventId])
  const editingAlbum = useMemo(()=>albums.find(album=>album.event_id===editEventId)||null,[albums,editEventId])
  const selectedEvent = useMemo(()=>events.find(item=>item.id===editEventId)||null,[events,editEventId])

  useEffect(()=>{
    if(!adminMode)return
    setCoverFile(null)
    setTransferUrl(editingAlbum?.transfer_url || '')
    setExpiresAt(expiryValue(editingAlbum?.transfer_expires_at))
    setItemCount(editingAlbum?.item_count == null ? '' : String(editingAlbum.item_count))
    setDownloadNote(editingAlbum?.download_note || '')
    setAlbumAudience(editingAlbum?.audience || selectedEvent?.audience || 'everyone')
    const mode=editingAlbum?stateForAlbum(editingAlbum):'published'
    setPublicationMode(mode)
    setPublishAt(mode==='scheduled'?toLocalInput(editingAlbum?.publish_at):'')
    setNotifyOnPublish(editingAlbum?.notify_on_publish!==false)
  },[adminMode,editEventId,editingAlbum?.id,selectedEvent?.audience])

  const isExpired = album => Boolean(album?.transfer_expires_at && new Date(album.transfer_expires_at).getTime() < Date.now())
  const coverFor = album => coverUrls.get(album.id) || album.image_url || null
  const paramsForEvent=(eventId)=>embeddedAdmin?{type:'albums',...(eventId?{event:eventId}:{})}:eventId?{event:eventId}:{}

  const publicationValues=()=>{
    if(publicationMode==='draft')return{published:false,publish_at:editingAlbum?.publish_at||new Date().toISOString()}
    if(publicationMode==='scheduled'){
      if(!publishAt)throw new Error('Choisissez la date et l’heure de publication.')
      const date=new Date(publishAt)
      if(Number.isNaN(date.getTime())||date<=new Date())throw new Error('Choisissez une date de publication future.')
      return{published:true,publish_at:date.toISOString()}
    }
    const alreadyPublished=editingAlbum&&editingAlbum.published!==false&&editingAlbum.publish_at&&new Date(editingAlbum.publish_at).getTime()<=Date.now()
    return{published:true,publish_at:alreadyPublished?editingAlbum.publish_at:new Date().toISOString()}
  }

  const saveAlbum = async (event) => {
    event.preventDefault()
    if(saving)return
    if(!editEventId)return setError('Choisissez un événement.')
    if(!editingAlbum && !coverFile)return setError('Ajoutez une photo de miniature pour ce nouvel album.')
    if(coverFile && (!coverFile.type.startsWith('image/') || coverFile.size > IMAGE_LIMIT))return setError('La miniature doit être une image de 30 Mo maximum avant optimisation.')
    if(transferUrl && !/^https:\/\//i.test(transferUrl.trim()))return setError('Le lien de téléchargement doit commencer par https://')
    if(transferUrl && expiresAt && new Date(`${expiresAt}T23:59:59`).getTime() <= Date.now())return setError('Pour un nouveau lien de téléchargement, choisissez une date d’expiration future.')

    setSaving(true); setError(''); setSuccess('')
    let uploaded = null
    let databaseSaved = false
    let cleanupWarning = false
    try{
      const publication=publicationValues()
      const originalState=editingAlbum?stateForAlbum(editingAlbum):null
      const resetNotification=Boolean(editingAlbum&&((originalState==='draft'&&publication.published)||(publicationMode==='scheduled'&&publication.publish_at!==editingAlbum.publish_at)))
      const payload = {
        event_id: editEventId,
        transfer_provider: 'wetransfer',
        transfer_url: transferUrl.trim() || null,
        transfer_expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
        item_count: itemCount === '' ? null : Math.max(0,Number.parseInt(itemCount,10)||0),
        download_note: downloadNote.trim() || null,
        audience: albumAudience,
        published: publication.published,
        publish_at: publication.publish_at,
        notify_on_publish: notifyOnPublish,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }
      if(resetNotification)payload.notified_at=null
      if(!editingAlbum)payload.created_by=user.id
      if(coverFile){
        const optimized = await optimizeImageFile(coverFile,{maxDimension:1280,quality:.8})
        uploaded = await uploadPrivateMedia(optimized,{scope:'gallery',parentId:editEventId,fallbackBucket:'gallery'})
        Object.assign(payload,{storage_provider:uploaded.storage_provider,storage_path:uploaded.storage_path,image_url:null,mime_type:optimized.type,file_size:optimized.size,source_gallery_id:null})
      }
      const {error:upsertError} = await supabase.from('event_albums').upsert(payload,{onConflict:'event_id'})
      if(upsertError)throw upsertError
      databaseSaved = true
      if(coverFile && editingAlbum?.storage_path && editingAlbum.source_gallery_id == null){
        try{await removePrivateMedia(editingAlbum,{fallbackBucket:'gallery'})}catch(_){cleanupWarning=true}
      }
      setCoverFile(null)
      const input=document.getElementById('album-cover-file'); if(input)input.value=''
      setSuccess(`${cleanupWarning?'Album enregistré ; l’ancienne miniature n’a pas pu être nettoyée automatiquement.':'Album enregistré.'} ${stateLabel(publicationMode)}${notifyOnPublish?' · notification activée':' · sans notification'}.`)
      setSearchParams(paramsForEvent(editEventId))
      await load()
    }catch(err){
      if(uploaded&&!databaseSaved)await removePrivateMedia(uploaded,{fallbackBucket:'gallery'}).catch(()=>{})
      setError(err.message||'Impossible d’enregistrer cet album.')
    }finally{setSaving(false)}
  }

  const deleteAlbum = async album => {
    if(saving||!window.confirm(`Supprimer l’album « ${album.event?.title||'sans titre'} » du site ? Le transfert WeTransfer externe ne sera pas supprimé.`))return
    setSaving(true);setError('');setSuccess('')
    try{
      const {error:deleteError}=await supabase.from('event_albums').delete().eq('id',album.id)
      if(deleteError)throw deleteError
      let cleanupWarning=false
      if(album.storage_path && album.source_gallery_id == null){try{await removePrivateMedia(album,{fallbackBucket:'gallery'})}catch(_){cleanupWarning=true}}
      setSearchParams(paramsForEvent('')); if(editEventId===album.event_id)setEditEventId('')
      setSuccess(cleanupWarning?'Album supprimé. Un ancien fichier de miniature n’a pas pu être nettoyé automatiquement du stockage.':'Album supprimé du site. Le lien externe reste géré dans votre compte WeTransfer.')
      await load()
    }catch(err){setError(err.message||'Suppression impossible.')}finally{setSaving(false)}
  }

  const publishAlbumNow=async album=>{
    if(saving)return
    setSaving(true);setError('');setSuccess('')
    const payload={published:true,publish_at:new Date().toISOString()}
    if(album.notify_on_publish!==false)payload.notified_at=null
    const {error:updateError}=await supabase.from('event_albums').update(payload).eq('id',album.id)
    if(updateError)setError(updateError.message||'Publication impossible.')
    else{setSuccess('Album publié. La notification sera traitée automatiquement si elle est activée.');await load()}
    setSaving(false)
  }

  const unpublishAlbum=async album=>{
    if(saving||!window.confirm(`Dépublier l’album « ${album.event?.title||'sans titre'} » ? Il restera enregistré dans l’administration.`))return
    setSaving(true);setError('');setSuccess('')
    const {error:updateError}=await supabase.from('event_albums').update({published:false}).eq('id',album.id)
    if(updateError)setError(updateError.message||'Dépublication impossible.')
    else{setSuccess('Album repassé en brouillon.');await load()}
    setSaving(false)
  }

  const resendAlbumNotification=async album=>{
    if(saving||!window.confirm(`Renvoyer une notification pour l’album « ${album.event?.title||'sans titre'} » ?`))return
    setSaving(true);setError('');setSuccess('')
    const {error:updateError}=await supabase.from('event_albums').update({notify_on_publish:true,notified_at:null}).eq('id',album.id)
    if(updateError)setError(updateError.message||'Impossible de remettre la notification en file d’attente.')
    else{setSuccess('Notification remise en file d’attente.');await load()}
    setSaving(false)
  }

  const adminEditor=adminMode&&<>
    {!embeddedAdmin&&<div style={{marginBottom:'1rem'}}><Link className="ghost-button" to="/administration">← Administration</Link></div>}
    <section className="gallery-upload-panel light-album-admin">
      <div><span className="eyebrow">Administration</span><h2>Album</h2><p>Associez l’album à un événement, ajoutez sa miniature et son lien de téléchargement, puis choisissez sa visibilité et sa date de publication.</p><div className="privacy-note"><strong>Expiration :</strong> à la date indiquée, le bouton de téléchargement disparaît automatiquement pour les membres. La miniature reste visible tant que l’album est publié.</div><a className="secondary-button external-album-link" href="https://wetransfer.com/" target="_blank" rel="noopener noreferrer">Ouvrir WeTransfer ↗</a></div>
      <form onSubmit={saveAlbum}>
        <label>Événement<select required disabled={saving||Boolean(editingAlbum)} value={editEventId} onChange={e=>setEditEventId(e.target.value)}><option value="">Choisir un événement…</option>{events.map(item=><option key={item.id} value={item.id}>{formatDate(item.starts_at)} — {item.title}{item.published===false?' · brouillon':''}</option>)}</select></label>
        <label>Miniature {editingAlbum?'(laisser vide pour conserver l’actuelle)':'(obligatoire)'}<input id="album-cover-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={e=>setCoverFile(e.target.files?.[0]||null)}/></label>
        {editingAlbum&&coverFor(editingAlbum)&&<img className="album-admin-current-cover" src={coverFor(editingAlbum)} alt="Miniature actuelle"/>}
        <label>Lien WeTransfer<input type="url" maxLength="1000" disabled={saving} placeholder="https://we.tl/..." value={transferUrl} onChange={e=>setTransferUrl(e.target.value)}/></label>
        <div className="album-admin-two"><label>Expiration du lien<input type="date" disabled={saving} value={expiresAt} onChange={e=>setExpiresAt(e.target.value)}/></label><label>Nombre de médias (facultatif)<input type="number" min="0" max="100000" inputMode="numeric" disabled={saving} value={itemCount} onChange={e=>setItemCount(e.target.value)}/></label></div>
        <label>Information pour les membres (facultatif)<input maxLength="180" disabled={saving} placeholder="Ex. Mot de passe transmis séparément" value={downloadNote} onChange={e=>setDownloadNote(e.target.value)}/></label>
        <div className="admin-publication-options"><label>Audience<select disabled={saving} value={albumAudience} onChange={e=>setAlbumAudience(e.target.value)}>{Object.entries(audienceLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label>État<select disabled={saving} value={publicationMode} onChange={e=>setPublicationMode(e.target.value)}><option value="draft">Brouillon · invisible</option><option value="published">Publié</option><option value="scheduled">Programmé</option></select></label></div>
        {publicationMode==='scheduled'&&<label>Date et heure de publication<input type="datetime-local" required disabled={saving} value={publishAt} onChange={e=>setPublishAt(e.target.value)}/></label>}
        <label className="admin-notification-toggle"><span><strong>Notifier les utilisateurs à la publication</strong><small>Les préférences personnelles des comptes restent prioritaires.</small></span><input type="checkbox" checked={notifyOnPublish} disabled={saving} onChange={e=>setNotifyOnPublish(e.target.checked)}/></label>
        <div className="gallery-upload-limits">La miniature est automatiquement réduite à 1280 px. Aucune vidéo ni album complet n’est envoyé vers notre serveur.</div>
        <div style={{display:'flex',gap:'.65rem',flexWrap:'wrap'}}><button className="primary-button" disabled={saving}>{saving?'Enregistrement…':editingAlbum?'Enregistrer les modifications':'Créer l’album'}</button>{editingAlbum&&<button type="button" className="ghost-button admin-danger-button" onClick={()=>deleteAlbum(editingAlbum)} disabled={saving}>Supprimer</button>}</div>
      </form>
    </section>
  </>

  if(embeddedAdmin){
    return <div className="admin-content-shell">{adminEditor}{error&&<div className="alert error">{error}</div>}{success&&<div className="alert">{success}</div>}<section className="text-panel"><div className="admin-notification-heading"><div><span className="eyebrow">Gestion</span><h2>Albums enregistrés</h2></div><small className="admin-inline-note">Modifier, publier, dépublier, renotifier ou supprimer depuis la même liste.</small></div>{loading?<div className="skeleton-card"/>:albums.length===0?<div className="admin-content-empty">Aucun album.</div>:<div className="admin-content-list">{albums.map(album=>{const state=stateForAlbum(album);return <article className="admin-content-row" key={album.id}><div><h3>{album.event?.title||'Album'}</h3><div className="admin-content-meta"><span className={`publication-state ${state}`}>{stateLabel(state)}</span><span className="role-badge">{audienceLabels[album.audience]||'Tout le monde'}</span><span className={`publication-state ${album.notify_on_publish===false?'no-notify':album.notified_at?'notified':''}`}>{album.notify_on_publish===false?'Sans notification':album.notified_at?'Notifiée':state==='scheduled'?'Notification programmée':'Notification en attente'}</span>{isExpired(album)&&<span className="role-badge">Lien expiré</span>}</div><small>{state==='scheduled'?`Publication prévue le ${new Date(album.publish_at).toLocaleString('fr-FR')}`:album.event?.starts_at?`Événement du ${formatDate(album.event.starts_at)}`:''}</small></div><div className="admin-content-actions"><button type="button" className="ghost-button" disabled={saving} onClick={()=>{setEditEventId(album.event_id);setSearchParams(paramsForEvent(album.event_id));window.scrollTo({top:0,behavior:'smooth'})}}>Modifier</button>{state!=='published'&&<button type="button" className="ghost-button" disabled={saving} onClick={()=>publishAlbumNow(album)}>Publier maintenant</button>}{state!=='draft'&&<button type="button" className="ghost-button" disabled={saving} onClick={()=>unpublishAlbum(album)}>Dépublier</button>}{state==='published'&&album.notified_at&&<button type="button" className="ghost-button" disabled={saving} onClick={()=>resendAlbumNotification(album)}>Renvoyer notification</button>}<button type="button" className="ghost-button admin-danger-button" disabled={saving} onClick={()=>deleteAlbum(album)}>Supprimer</button></div></article>})}</div>}</section></div>
  }

  return <>
    <PageTitle eyebrow="Souvenirs" title={adminMode?'Albums & téléchargements':'Galerie'} text={adminMode?'Une seule miniature est stockée sur le site. Les albums complets restent sur WeTransfer ou un autre service externe de téléchargement.':'La galerie reste légère : une miniature par événement, puis le téléchargement complet s’ouvre uniquement à votre demande.'} />
    {adminEditor}
    {error&&<div className="alert error" style={{marginBottom:'1rem'}}>{error}</div>}{success&&<div className="alert" style={{marginBottom:'1rem'}}>{success}</div>}
    {loading?<div className="skeleton-card tall"/>:selectedAlbum?<section className="light-album-detail">
      <button type="button" className="secondary-button" onClick={()=>setSearchParams(paramsForEvent(''))}>← Tous les albums</button>
      <div className="light-album-hero"><div className="light-album-cover">{coverFor(selectedAlbum)?<img src={coverFor(selectedAlbum)} alt=""/>:<span>📷</span>}</div><div className="light-album-copy">
        {isExpired(selectedAlbum)?<><span className="eyebrow">Album expiré</span><h2>{selectedAlbum.event?.title||'Album'}</h2>{selectedAlbum.event?.starts_at&&<p>📅 {formatDate(selectedAlbum.event.starts_at)}</p>}<div className="alert warning"><strong>Lien expiré.</strong><br/>Le contenu complet n’est plus accessible. La miniature reste visible jusqu’au renouvellement éventuel du transfert.</div></>:<><span className="eyebrow">Album événement</span><h2>{selectedAlbum.event?.title||'Album'}</h2>{selectedAlbum.event?.starts_at&&<p>📅 {formatDate(selectedAlbum.event.starts_at)}</p>}{selectedAlbum.event?.location&&<p>📍 {selectedAlbum.event.location}</p>}{selectedAlbum.item_count!=null&&<p>📷 {selectedAlbum.item_count} média{selectedAlbum.item_count>1?'s':''}</p>}{selectedAlbum.event?.description&&<p className="gallery-album-description">{selectedAlbum.event.description}</p>}{selectedAlbum.download_note&&<div className="privacy-note">{selectedAlbum.download_note}</div>}{selectedAlbum.transfer_url?<><a className="primary-button album-download-button" href={selectedAlbum.transfer_url} target="_blank" rel="noopener noreferrer">Télécharger l’album complet ↗</a>{selectedAlbum.transfer_expires_at&&<small className="album-expiry">Disponible jusqu’au {formatDate(selectedAlbum.transfer_expires_at)}</small>}</>:<div className="empty-state compact-empty">Le téléchargement complet de cet album n’est pas encore publié.</div>}</>}
      </div></div>
    </section>:albums.length?<div className="gallery-album-grid">{albums.map(album=>{const expired=isExpired(album);return <button type="button" className="gallery-album-card" key={album.id} onClick={()=>setSearchParams(paramsForEvent(album.event_id))}><div className="gallery-album-cover">{coverFor(album)?<img src={coverFor(album)} alt="" loading="lazy" decoding="async"/>:<span>📷</span>}<div className="gallery-album-count">{album.item_count!=null?`${album.item_count} média${album.item_count>1?'s':''}`:'Album'}</div>{expired&&<div className="album-expired-badge">Lien expiré</div>}</div><div className="gallery-album-info"><strong>{album.event?.title||'Album'}</strong>{album.event?.starts_at&&<span>{formatDate(album.event.starts_at)}</span>}<small>{expired?'Lien expiré':album.transfer_url?'Téléchargement disponible →':'Voir l’album →'}</small></div></button>})}</div>:<div className="empty-state">Aucun album partagé pour votre profil.</div>}
  </>
}
