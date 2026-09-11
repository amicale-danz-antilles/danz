import { useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getR2Status, optimizeImageFile, removePrivateMedia, uploadPrivateMedia } from '../lib/mediaStorage.js'
import { PageTitle } from './Actualites.jsx'
import Galerie from './Galerie.jsx'
import '../admin-content-unified.css'

const audienceLabels={everyone:'Tout le monde',military:'Militaires DANZ uniquement',amicaliste:'Amicalistes uniquement',admin:'Bureau / Admin uniquement'}
const validTypes=new Set(['news','events','albums'])
const toLocalInput=(value)=>{if(!value)return'';const d=new Date(value);const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,16)}
const PHOTO_LIMIT=30*1024*1024
const FILE_LIMIT=200*1024*1024

const stateForItem=(item)=>{
 if(item?.published===false)return'draft'
 if(item?.publish_at&&new Date(item.publish_at).getTime()>Date.now())return'scheduled'
 return'published'
}
const stateLabel=(state)=>state==='draft'?'Brouillon':state==='scheduled'?'Programmé':'Publié'

export default function AdminContent(){
 const {user,isAdmin,loading:authLoading}=useAuth()
 const [searchParams,setSearchParams]=useSearchParams()
 const initialType=validTypes.has(searchParams.get('type'))?searchParams.get('type'):'news'
 const [type,setType]=useState(initialType)
 const [editing,setEditing]=useState(null)
 const [title,setTitle]=useState('')
 const [text,setText]=useState('')
 const [location,setLocation]=useState('')
 const [startsAt,setStartsAt]=useState('')
 const [endsAt,setEndsAt]=useState('')
 const [cover,setCover]=useState(null)
 const [files,setFiles]=useState([])
 const [audience,setAudience]=useState('everyone')
 const [publicationMode,setPublicationMode]=useState('published')
 const [publishAt,setPublishAt]=useState('')
 const [notifyOnPublish,setNotifyOnPublish]=useState(true)
 const [recent,setRecent]=useState([])
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [success,setSuccess]=useState('')
 const [r2Ready,setR2Ready]=useState(false)
 const [notificationSettings,setNotificationSettings]=useState({enabled:true,news:true,events:true,gallery:true,membership_requests:true})
 const [notificationStats,setNotificationStats]=useState({devices:0,preferences:0,news:0,events:0,gallery:0})
 const [notificationBusy,setNotificationBusy]=useState('')

 useEffect(()=>{
  const next=searchParams.get('type')
  if(validTypes.has(next)&&next!==type){setType(next);reset(false)}
 },[searchParams])

 const loadRecent=async()=>{
  if(!isAdmin||type==='albums')return
  const {data,error:loadError}=await supabase.from(type).select('*').order('publish_at',{ascending:false}).limit(40)
  if(loadError)setError('Impossible de charger la liste des publications enregistrées.')
  setRecent(data||[])
 }

 const loadNotificationAdmin=async()=>{
  if(!isAdmin)return
  const [settingsResult,subscriptionsResult,prefsResult]=await Promise.all([
   supabase.from('notification_settings').select('enabled,news,events,gallery,membership_requests').eq('id',1).single(),
   supabase.from('push_subscriptions').select('id',{count:'exact',head:true}),
   supabase.from('notification_preferences').select('news,events,gallery'),
  ])
  if(!settingsResult.error&&settingsResult.data)setNotificationSettings(settingsResult.data)
  const prefs=prefsResult.data||[]
  setNotificationStats({
   devices:subscriptionsResult.count||0,
   preferences:prefs.length,
   news:prefs.filter(row=>row.news!==false).length,
   events:prefs.filter(row=>row.events!==false).length,
   gallery:prefs.filter(row=>row.gallery!==false).length,
  })
 }

 useEffect(()=>{loadRecent()},[type,isAdmin])
 useEffect(()=>{if(isAdmin){getR2Status().then(setR2Ready);loadNotificationAdmin()}},[isAdmin])
 if(!authLoading&&!isAdmin)return <Navigate to="/" replace/>

 const reset=(clearMessages=true)=>{
  setEditing(null);setTitle('');setText('');setLocation('');setStartsAt('');setEndsAt('');setCover(null);setFiles([]);setAudience('everyone');setPublicationMode('published');setPublishAt('');setNotifyOnPublish(true)
  if(clearMessages){setError('');setSuccess('')}
  const a=document.getElementById('content-cover');if(a)a.value=''
  const b=document.getElementById('content-files');if(b)b.value=''
 }

 const switchType=(next)=>{
  if(next===type)return
  reset();setRecent([]);setType(next);setSearchParams({type:next})
 }

 const beginEdit=(item)=>{
  setEditing(item);setTitle(item.title||'');setText(type==='news'?(item.content||''):(item.description||''));setLocation(type==='events'?(item.location||''):'');setStartsAt(type==='events'?toLocalInput(item.starts_at):'');setEndsAt(type==='events'?toLocalInput(item.ends_at):'');setAudience(item.audience||'everyone');setPublicationMode(stateForItem(item));setPublishAt(stateForItem(item)==='scheduled'?toLocalInput(item.publish_at):'');setNotifyOnPublish(item.notify_on_publish!==false);setCover(null);setFiles([]);setError('');setSuccess('');window.scrollTo({top:0,behavior:'smooth'})
 }

 const validatePhoto=(file)=>{if(!file)return;if(!file.type.startsWith('image/'))throw new Error('La photo principale doit être une image.');if(file.size>PHOTO_LIMIT)throw new Error('La photo principale dépasse 30 Mo avant optimisation.')}
 const validateFiles=(list)=>list.forEach(file=>{if(file.size>FILE_LIMIT)throw new Error(`${file.name} dépasse 200 Mo.`)})

 const addAttachment=async(file,parentType,parentId,isCover=false)=>{
  const stored=await uploadPrivateMedia(file,{scope:'content',parentId,fallbackBucket:'content'})
  const parentColumn=parentType==='news'?'news_id':'event_id'
  const payload={news_id:parentType==='news'?parentId:null,event_id:parentType==='events'?parentId:null,file_name:file.name||'fichier',storage_provider:stored.storage_provider,storage_path:stored.storage_path,mime_type:file.type||null,file_size:file.size,is_cover:isCover,created_by:user.id}
  const {data,error:insertError}=await supabase.from('content_attachments').insert(payload).select('*').single()
  if(insertError){await removePrivateMedia({...stored},{fallbackBucket:'content'}).catch(()=>{});throw insertError}
  if(isCover){
   const {error:demoteError}=await supabase.from('content_attachments').update({is_cover:false}).eq(parentColumn,parentId).eq('is_cover',true).neq('id',data.id)
   if(demoteError){await supabase.from('content_attachments').delete().eq('id',data.id);await removePrivateMedia({...data,...stored},{entity:'attachment',fallbackBucket:'content'}).catch(()=>{});throw demoteError}
  }
  return data
 }

 const publicationValues=()=>{
  if(publicationMode==='draft')return{published:false,publish_at:editing?.publish_at||new Date().toISOString()}
  if(publicationMode==='scheduled'){
   if(!publishAt)throw new Error('Choisissez la date et l’heure de publication.')
   const d=new Date(publishAt)
   if(Number.isNaN(d.getTime())||d<=new Date())throw new Error('Choisissez une date de publication future.')
   return{published:true,publish_at:d.toISOString()}
  }
  const editingAlreadyPublished=editing&&editing.published!==false&&editing.publish_at&&new Date(editing.publish_at).getTime()<=Date.now()
  return{published:true,publish_at:editingAlreadyPublished?editing.publish_at:new Date().toISOString()}
 }

 const submit=async(e)=>{
  e.preventDefault();if(busy)return;setBusy(true);setError('');setSuccess('')
  let parentId=editing?.id||null
  let createdParent=false
  const createdAssets=[]
  try{
   if(!title.trim())throw new Error('Ajoutez un titre.')
   validatePhoto(cover);validateFiles(files)
   const publication=publicationValues()
   const originalState=editing?stateForItem(editing):null
   const scheduleChanged=Boolean(editing&&publicationMode==='scheduled'&&publication.publish_at!==editing.publish_at)
   const firstPublication=Boolean(editing&&originalState==='draft'&&publication.published)
   const resetNotification=firstPublication||scheduleChanged

   if(type==='news'){
    const payload={title:title.trim(),summary:text.trim().slice(0,260)||null,content:text.trim()||null,audience,published:publication.published,publish_at:publication.publish_at,notify_on_publish:notifyOnPublish}
    if(!editing)payload.published_at=publication.published?publication.publish_at:new Date().toISOString()
    else if(firstPublication)payload.published_at=publication.publish_at
    if(resetNotification)payload.notified_at=null
    const result=editing?await supabase.from('news').update(payload).eq('id',editing.id).select('id').single():await supabase.from('news').insert({...payload,created_by:user.id}).select('id').single()
    if(result.error)throw result.error;parentId=result.data.id;createdParent=!editing
   }else{
    if(!startsAt)throw new Error('Indiquez la date et l’heure de l’événement.')
    const start=new Date(startsAt),end=endsAt?new Date(endsAt):null
    if(Number.isNaN(start.getTime()))throw new Error('Date de début invalide.')
    if(end&&end<=start)throw new Error('La fin doit être après le début.')
    const payload={title:title.trim(),description:text.trim()||null,location:location.trim()||null,starts_at:start.toISOString(),ends_at:end?end.toISOString():null,audience,published:publication.published,publish_at:publication.publish_at,notify_on_publish:notifyOnPublish}
    if(resetNotification)payload.notified_at=null
    const result=editing?await supabase.from('events').update(payload).eq('id',editing.id).select('id').single():await supabase.from('events').insert({...payload,created_by:user.id}).select('id').single()
    if(result.error)throw result.error;parentId=result.data.id;createdParent=!editing
   }

   if(cover){const optimizedCover=await optimizeImageFile(cover);createdAssets.push(await addAttachment(optimizedCover,type,parentId,true))}
   if(type==='news'&&files.length)for(const file of files)createdAssets.push(await addAttachment(file,'news',parentId,false))
   setSuccess(`${type==='news'?'Actualité':'Événement'} ${editing?'modifié':'enregistré'} · ${stateLabel(publicationMode).toLowerCase()}${notifyOnPublish?' · notification activée':' · sans notification'}.`)
   reset(false);await loadRecent()
  }catch(err){
   if(createdParent&&parentId){for(const asset of createdAssets)await removePrivateMedia(asset,{entity:'attachment',fallbackBucket:'content'}).catch(()=>{});await supabase.from(type).delete().eq('id',parentId)}
   const suffix=editing&&createdAssets.length?' Les modifications du texte ont pu être enregistrées avant l’échec d’un fichier ; vérifiez la publication avant de recommencer.':''
   setError(`${err.message||'Impossible d’enregistrer cette publication.'}${suffix}`)
  }finally{setBusy(false)}
 }

 const removeItem=async(item)=>{
  if(busy||!window.confirm(`Supprimer définitivement « ${item.title} » ? Cette action retire aussi ses fichiers et son album lié le cas échéant.`))return
  setBusy(true);setError('');setSuccess('')
  try{
   const parentColumn=type==='news'?'news_id':'event_id'
   const {data:attachments,error:attachmentsError}=await supabase.from('content_attachments').select('*').eq(parentColumn,item.id)
   if(attachmentsError)throw attachmentsError
   let albumRows=[]
   if(type==='events'){
    const {data,error:albumError}=await supabase.from('event_albums').select('*').eq('event_id',item.id)
    if(albumError)throw albumError
    albumRows=data||[]
   }
   const {error:deleteError}=await supabase.from(type).delete().eq('id',item.id)
   if(deleteError)throw deleteError
   let cleanupWarning=false
   for(const asset of attachments||[]){try{await removePrivateMedia(asset,{entity:'attachment',fallbackBucket:'content'})}catch(_){cleanupWarning=true}}
   for(const album of albumRows){if(album.storage_path&&album.source_gallery_id==null){try{await removePrivateMedia(album,{entity:'album',fallbackBucket:'gallery'})}catch(_){cleanupWarning=true}}}
   if(editing?.id===item.id)reset(false)
   setSuccess(cleanupWarning?'Publication supprimée. Un ancien fichier n’a pas pu être nettoyé automatiquement du stockage.':'Publication et fichiers associés supprimés.')
   await loadRecent()
  }catch(err){setError(err.message||'Suppression impossible.')}finally{setBusy(false)}
 }

 const setPublishedNow=async(item)=>{
  if(busy)return
  setBusy(true);setError('');setSuccess('')
  const payload={published:true,publish_at:new Date().toISOString()}
  if(item.notify_on_publish!==false)payload.notified_at=null
  const {error:updateError}=await supabase.from(type).update(payload).eq('id',item.id)
  if(updateError)setError(updateError.message||'Publication impossible.')
  else{setSuccess('Publication mise en ligne. La notification sera traitée automatiquement si elle est activée.');await loadRecent()}
  setBusy(false)
 }

 const unpublishItem=async(item)=>{
  if(busy||!window.confirm(`Dépublier « ${item.title} » ? Le contenu restera enregistré dans l’administration.`))return
  setBusy(true);setError('');setSuccess('')
  const {error:updateError}=await supabase.from(type).update({published:false}).eq('id',item.id)
  if(updateError)setError(updateError.message||'Dépublication impossible.')
  else{setSuccess('Publication repassée en brouillon.');if(editing?.id===item.id)setPublicationMode('draft');await loadRecent()}
  setBusy(false)
 }

 const resendNotification=async(item)=>{
  if(busy||!window.confirm(`Renvoyer une notification pour « ${item.title} » ? Les utilisateurs ayant désactivé cette catégorie ne la recevront pas.`))return
  setBusy(true);setError('');setSuccess('')
  const {error:updateError}=await supabase.from(type).update({notify_on_publish:true,notified_at:null}).eq('id',item.id)
  if(updateError)setError(updateError.message||'Impossible de remettre la notification en file d’attente.')
  else{setSuccess('Notification remise en file d’attente. Elle sera traitée automatiquement dans la minute.');await loadRecent()}
  setBusy(false)
 }

 const saveNotificationSetting=async(key,value)=>{
  if(notificationBusy)return
  const previous=notificationSettings
  const next={...notificationSettings,[key]:value}
  setNotificationSettings(next);setNotificationBusy(key);setError('')
  const {error:updateError}=await supabase.from('notification_settings').update({[key]:value,updated_by:user.id}).eq('id',1)
  if(updateError){setNotificationSettings(previous);setError('Impossible d’enregistrer ce réglage de notifications.')}
  else await loadNotificationAdmin()
  setNotificationBusy('')
 }

 const notificationCategory=type==='news'?'news':type==='events'?'events':'gallery'
 const globalNotificationEnabled=notificationSettings.enabled&&notificationSettings[notificationCategory]
 const notificationLabels={enabled:['Notifications push','Coupe ou autorise tous les envois du site'],news:['Actualités','Autoriser les notifications des actualités'],events:['Événements','Autoriser les notifications des événements'],gallery:['Albums','Autoriser les notifications des nouveaux albums'],membership_requests:['Demandes d’accès','Prévenir les administrateurs des nouvelles demandes']}

 const notificationPanel=<section className="text-panel admin-notification-panel">
  <div className="admin-notification-heading"><div><span className="eyebrow">Notifications</span><h2>Réception & réglages</h2><p>Les réglages administrateur autorisent ou bloquent les envois. Chaque utilisateur conserve ensuite ses propres préférences dans son profil.</p></div><span className={`admin-notification-status ${notificationSettings.enabled?'':'off'}`}>{notificationSettings.enabled?'● Service autorisé':'○ Envois coupés'}</span></div>
  <div className="admin-notification-stats"><span className="role-badge">{notificationStats.devices} appareil{notificationStats.devices>1?'s':''} abonné{notificationStats.devices>1?'s':''}</span><span className="role-badge">{notificationStats.news}/{notificationStats.preferences} actualités</span><span className="role-badge">{notificationStats.events}/{notificationStats.preferences} événements</span><span className="role-badge">{notificationStats.gallery}/{notificationStats.preferences} albums</span></div>
  <div className="admin-notification-grid">{Object.entries(notificationLabels).map(([key,[label,description]])=><label className="admin-notification-toggle" key={key}><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={Boolean(notificationSettings[key])} disabled={Boolean(notificationBusy)} onChange={e=>saveNotificationSetting(key,e.target.checked)}/></label>)}</div>
  <div className="privacy-note"><strong>Fonctionnement :</strong> les publications programmées sont vérifiées automatiquement chaque minute. Une notification n’est envoyée que si le réglage administrateur, le réglage de la publication et la préférence personnelle du destinataire l’autorisent.</div>
 </section>

 return <div className="admin-content-shell">
  <PageTitle eyebrow="Administration" title="Publications" text="Un seul endroit pour créer, modifier, programmer, dépublier ou supprimer les actualités, événements et albums."/>
  <div className="admin-content-tabs" role="tablist" aria-label="Type de publication"><button type="button" className={`admin-content-tab ${type==='news'?'active':''}`} onClick={()=>switchType('news')}>📰 Actualités</button><button type="button" className={`admin-content-tab ${type==='events'?'active':''}`} onClick={()=>switchType('events')}>📅 Événements</button><button type="button" className={`admin-content-tab ${type==='albums'?'active':''}`} onClick={()=>switchType('albums')}>🖼️ Albums</button></div>
  {notificationPanel}

  {type==='albums'?<Galerie forceAdminMode embeddedAdmin/>:<>
   <div className="text-panel"><form onSubmit={submit}>
    {editing&&<div className="alert"><strong>Modification :</strong> {editing.title}</div>}
    <label>Titre<input required maxLength="160" disabled={busy} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>{type==='news'?'Information':'Description'}<textarea rows="6" maxLength="10000" disabled={busy} value={text} onChange={e=>setText(e.target.value)} placeholder={type==='news'?'Écrivez directement l’information à publier…':'Présentez le rendez-vous…'}/></label>
    {type==='events'&&<><label>Lieu<input maxLength="180" disabled={busy} value={location} onChange={e=>setLocation(e.target.value)}/></label><label>Date et heure de l’événement<input type="datetime-local" required disabled={busy} value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></label><label>Fin (facultatif)<input type="datetime-local" disabled={busy} value={endsAt} onChange={e=>setEndsAt(e.target.value)}/></label></>}
    <label>Photo principale (facultatif)<input id="content-cover" type="file" accept="image/*" disabled={busy} onChange={e=>setCover(e.target.files?.[0]||null)}/><small>Une nouvelle photo remplace automatiquement la photo principale actuelle.</small></label>
    {type==='news'&&<label>Fichiers joints à ajouter (facultatif)<input id="content-files" type="file" multiple disabled={busy} onChange={e=>setFiles([...e.target.files])}/><small>PDF, Word, Excel, images ou autres fichiers utiles.</small></label>}
    <div className="admin-publication-options"><label>Audience<select disabled={busy} value={audience} onChange={e=>setAudience(e.target.value)}>{Object.entries(audienceLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label>État<select disabled={busy} value={publicationMode} onChange={e=>setPublicationMode(e.target.value)}><option value="draft">Brouillon · invisible</option><option value="published">Publié</option><option value="scheduled">Programmé</option></select></label></div>
    {publicationMode==='scheduled'&&<label>Date et heure de publication<input type="datetime-local" required disabled={busy} value={publishAt} onChange={e=>setPublishAt(e.target.value)}/></label>}
    <label className="admin-notification-toggle"><span><strong>Notifier les utilisateurs à la publication</strong><small>{globalNotificationEnabled?'La notification partira selon les préférences de chaque compte.':'La catégorie est actuellement désactivée dans les réglages administrateur.'}</small></span><input type="checkbox" checked={notifyOnPublish} disabled={busy} onChange={e=>setNotifyOnPublish(e.target.checked)}/></label>
    <div className="privacy-note">☁️ {r2Ready?'Cloudflare R2 est connecté pour les nouveaux fichiers.':'Supabase sert de stockage de secours tant que R2 n’est pas disponible.'}</div>
    {error&&<div className="alert error">{error}</div>}{success&&<div className="alert">{success}</div>}
    <div style={{display:'flex',gap:'.65rem',flexWrap:'wrap'}}><button className="primary-button" disabled={busy}>{busy?'Enregistrement…':editing?'Enregistrer les modifications':'Enregistrer la publication'}</button>{editing&&<button type="button" className="ghost-button" disabled={busy} onClick={()=>reset()}>Annuler</button>}</div>
   </form></div>

   <section className="text-panel"><div className="admin-notification-heading"><div><span className="eyebrow">Gestion</span><h2>{type==='news'?'Actualités':'Événements'} enregistrés</h2></div><small className="admin-inline-note">Modifier, publier, dépublier, renotifier ou supprimer depuis la même liste.</small></div>
    {recent.length===0?<div className="admin-content-empty">Aucune publication.</div>:<div className="admin-content-list">{recent.map(item=>{const state=stateForItem(item);const due=state==='published';return <article className="admin-content-row" key={item.id}><div><h3>{item.title}</h3><div className="admin-content-meta"><span className={`publication-state ${state}`}>{stateLabel(state)}</span><span className="role-badge">{audienceLabels[item.audience]||'Tout le monde'}</span><span className={`publication-state ${item.notify_on_publish===false?'no-notify':item.notified_at?'notified':''}`}>{item.notify_on_publish===false?'Sans notification':item.notified_at?'Notifiée':state==='scheduled'?'Notification programmée':'Notification en attente'}</span></div><small>{state==='scheduled'?`Publication prévue le ${new Date(item.publish_at).toLocaleString('fr-FR')}`:type==='events'&&item.starts_at?`Événement le ${new Date(item.starts_at).toLocaleString('fr-FR')}`:`Publication : ${new Date(item.publish_at||item.created_at).toLocaleString('fr-FR')}`}</small></div><div className="admin-content-actions"><button type="button" className="ghost-button" disabled={busy} onClick={()=>beginEdit(item)}>Modifier</button>{state!=='published'&&<button type="button" className="ghost-button" disabled={busy} onClick={()=>setPublishedNow(item)}>Publier maintenant</button>}{state!=='draft'&&<button type="button" className="ghost-button" disabled={busy} onClick={()=>unpublishItem(item)}>Dépublier</button>}{due&&item.notified_at&&<button type="button" className="ghost-button" disabled={busy} onClick={()=>resendNotification(item)}>Renvoyer notification</button>}<button type="button" className="ghost-button admin-danger-button" disabled={busy} onClick={()=>removeItem(item)}>Supprimer</button></div></article>})}</div>}
   </section>
  </>}
 </div>
}
