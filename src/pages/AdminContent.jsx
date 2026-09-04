import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getR2Status, optimizeImageFile, removePrivateMedia, uploadPrivateMedia } from '../lib/mediaStorage.js'
import { PageTitle } from './Actualites.jsx'

const audienceLabels={everyone:'Tout le monde',military:'Militaires DANZ uniquement',amicaliste:'Amicalistes uniquement',admin:'Bureau / Admin uniquement'}
const toLocalInput=(value)=>{if(!value)return'';const d=new Date(value);const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,16)}
const PHOTO_LIMIT=30*1024*1024
const FILE_LIMIT=200*1024*1024

export default function AdminContent(){
 const {user,isAdmin,loading:authLoading}=useAuth()
 const [type,setType]=useState('news')
 const [editing,setEditing]=useState(null)
 const [title,setTitle]=useState('')
 const [text,setText]=useState('')
 const [location,setLocation]=useState('')
 const [startsAt,setStartsAt]=useState('')
 const [endsAt,setEndsAt]=useState('')
 const [cover,setCover]=useState(null)
 const [files,setFiles]=useState([])
 const [audience,setAudience]=useState('everyone')
 const [schedule,setSchedule]=useState('now')
 const [publishAt,setPublishAt]=useState('')
 const [recent,setRecent]=useState([])
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [success,setSuccess]=useState('')
 const [r2Ready,setR2Ready]=useState(false)

 const loadRecent=async()=>{
  if(!isAdmin)return
  const {data,error:loadError}=await supabase.from(type).select('*').order(type==='events'?'starts_at':'publish_at',{ascending:false}).limit(20)
  if(loadError)setError(loadError.message)
  setRecent(data||[])
 }
 useEffect(()=>{loadRecent()},[type,isAdmin])
 useEffect(()=>{if(isAdmin)getR2Status().then(setR2Ready)},[isAdmin])
 if(!authLoading&&!isAdmin)return <Navigate to="/" replace/>

 const reset=()=>{setEditing(null);setTitle('');setText('');setLocation('');setStartsAt('');setEndsAt('');setCover(null);setFiles([]);setAudience('everyone');setSchedule('now');setPublishAt('');setError('');const a=document.getElementById('content-cover');if(a)a.value='';const b=document.getElementById('content-files');if(b)b.value=''}
 const beginEdit=(item)=>{setEditing(item);setTitle(item.title||'');setText(type==='news'?(item.content||''):(item.description||''));setLocation(type==='events'?(item.location||''):'');setStartsAt(type==='events'?toLocalInput(item.starts_at):'');setEndsAt(type==='events'?toLocalInput(item.ends_at):'');setAudience(item.audience||'everyone');setSchedule('keep');setPublishAt('');setCover(null);setFiles([]);setError('');setSuccess('');window.scrollTo({top:0,behavior:'smooth'})}

 const validatePhoto=(file)=>{if(!file)return;if(!file.type.startsWith('image/'))throw new Error('La photo principale doit être une image.');if(file.size>PHOTO_LIMIT)throw new Error('La photo principale dépasse 30 Mo avant optimisation.')}
 const validateFiles=(list)=>list.forEach(file=>{if(file.size>FILE_LIMIT)throw new Error(`${file.name} dépasse 200 Mo.`)})

 const addAttachment=async(file,parentType,parentId,isCover=false)=>{
  const stored=await uploadPrivateMedia(file,{scope:'content',parentId,fallbackBucket:'content'})
  if(isCover)await supabase.from('content_attachments').update({is_cover:false}).eq(parentType==='news'?'news_id':'event_id',parentId).eq('is_cover',true)
  const payload={news_id:parentType==='news'?parentId:null,event_id:parentType==='events'?parentId:null,file_name:file.name||'fichier',storage_provider:stored.storage_provider,storage_path:stored.storage_path,mime_type:file.type||null,file_size:file.size,is_cover:isCover,created_by:user.id}
  const {data,error:insertError}=await supabase.from('content_attachments').insert(payload).select('*').single()
  if(insertError){await removePrivateMedia({...stored},{fallbackBucket:'content'});throw insertError}
  return data
 }

 const submit=async(e)=>{
  e.preventDefault();setBusy(true);setError('');setSuccess('')
  try{
   if(!title.trim())throw new Error('Ajoutez un titre.')
   validatePhoto(cover);validateFiles(files)
   let publicationIso
   let resetNotification=false
   if(editing&&schedule==='keep')publicationIso=editing.publish_at||new Date().toISOString()
   else if(schedule==='later'){
    if(!publishAt)throw new Error('Choisissez la date et l’heure de publication.')
    const d=new Date(publishAt);if(Number.isNaN(d.getTime())||d<=new Date())throw new Error('Choisissez une date de publication future.')
    publicationIso=d.toISOString();resetNotification=Boolean(editing)
   }else{publicationIso=new Date().toISOString();if(editing?.publish_at&&new Date(editing.publish_at)>new Date())resetNotification=true}

   let parentId=editing?.id
   if(type==='news'){
    const payload={title:title.trim(),summary:text.trim().slice(0,260)||null,content:text.trim()||null,audience,published:true,publish_at:publicationIso}
    if(!editing||schedule!=='keep')payload.published_at=publicationIso
    if(resetNotification)payload.notified_at=null
    const result=editing?await supabase.from('news').update(payload).eq('id',editing.id).select('id').single():await supabase.from('news').insert({...payload,published_at:publicationIso,created_by:user.id}).select('id').single()
    if(result.error)throw result.error;parentId=result.data.id
   }else{
    if(!startsAt)throw new Error('Indiquez la date et l’heure de l’événement.')
    const start=new Date(startsAt),end=endsAt?new Date(endsAt):null
    if(Number.isNaN(start.getTime()))throw new Error('Date de début invalide.')
    if(end&&end<=start)throw new Error('La fin doit être après le début.')
    const payload={title:title.trim(),description:text.trim()||null,location:location.trim()||null,starts_at:start.toISOString(),ends_at:end?end.toISOString():null,audience,publish_at:publicationIso}
    if(resetNotification)payload.notified_at=null
    const result=editing?await supabase.from('events').update(payload).eq('id',editing.id).select('id').single():await supabase.from('events').insert({...payload,created_by:user.id}).select('id').single()
    if(result.error)throw result.error;parentId=result.data.id
   }

   if(cover){const optimizedCover=await optimizeImageFile(cover);await addAttachment(optimizedCover,type,parentId,true)}
   if(type==='news'&&files.length)for(const file of files)await addAttachment(file,'news',parentId,false)
   setSuccess(`${type==='news'?'Actualité':'Événement'} ${editing?'modifié':'publié'}${cover?' ; photo optimisée automatiquement':''}${r2Ready?' sur le stockage R2':''}.`)
   reset();await loadRecent()
  }catch(err){setError(err.message||'Impossible d’enregistrer cette publication.')}finally{setBusy(false)}
 }

 const removeItem=async(item)=>{
  if(!window.confirm(`Supprimer « ${item.title} » ?`))return
  const parentColumn=type==='news'?'news_id':'event_id'
  const {data:attachments}=await supabase.from('content_attachments').select('*').eq(parentColumn,item.id)
  for(const asset of attachments||[])await removePrivateMedia(asset,{entity:'attachment',fallbackBucket:'content'})
  const {error:deleteError}=await supabase.from(type).delete().eq('id',item.id)
  if(deleteError)setError(deleteError.message);else await loadRecent()
 }

 return <>
  <PageTitle eyebrow="Administration" title="Publier" text="Publiez simplement une actualité ou un événement. Les photos sont automatiquement redimensionnées pour rester rapides à afficher."/>
  <div className="text-panel"><form onSubmit={submit}>
    {editing&&<div className="alert"><strong>Modification :</strong> {editing.title}</div>}
    <label>Type<select disabled={Boolean(editing)} value={type} onChange={e=>{reset();setType(e.target.value)}}><option value="news">Actualité</option><option value="events">Événement</option></select></label>
    <label>Titre<input required maxLength="160" value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>{type==='news'?'Information':'Description'}<textarea rows="6" value={text} onChange={e=>setText(e.target.value)} placeholder={type==='news'?'Écrivez directement l’information à publier…':'Présentez le rendez-vous…'}/></label>
    {type==='events'&&<><label>Lieu<input maxLength="180" value={location} onChange={e=>setLocation(e.target.value)}/></label><label>Date et heure<input type="datetime-local" required value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></label><label>Fin (facultatif)<input type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)}/></label></>}
    <label>Photo principale (facultatif)<input id="content-cover" type="file" accept="image/*" onChange={e=>setCover(e.target.files?.[0]||null)}/><small>La photo sera automatiquement optimisée jusqu’à 1920 px avant l’envoi.</small></label>
    {type==='news'&&<label>Fichiers joints (facultatif)<input id="content-files" type="file" multiple onChange={e=>setFiles([...e.target.files])}/><small>PDF, Word, Excel, images ou autres fichiers utiles. Plusieurs fichiers possibles.</small></label>}
    <details className="good-deals-advanced"><summary>Options avancées</summary><div style={{display:'grid',gap:'1rem',marginTop:'1rem'}}><label>Audience<select value={audience} onChange={e=>setAudience(e.target.value)}><option value="everyone">Tout le monde</option><option value="military">Militaires DANZ uniquement</option><option value="amicaliste">Amicalistes uniquement</option><option value="admin">Bureau / Admin uniquement</option></select></label><label>Publication<select value={schedule} onChange={e=>setSchedule(e.target.value)}>{editing&&<option value="keep">Conserver la publication actuelle</option>}<option value="now">Publier maintenant</option><option value="later">Programmer pour plus tard</option></select></label>{schedule==='later'&&<label>Date de publication<input type="datetime-local" required value={publishAt} onChange={e=>setPublishAt(e.target.value)}/></label>}</div></details>
    <div className="privacy-note">☁️ {r2Ready?'Cloudflare R2 est connecté pour les nouveaux fichiers.':'Supabase sert de stockage de secours tant que R2 n’est pas disponible.'}</div>
    {error&&<div className="alert error">{error}</div>}{success&&<div className="alert">{success}</div>}
    <div style={{display:'flex',gap:'.65rem',flexWrap:'wrap'}}><button className="primary-button" disabled={busy}>{busy?'Enregistrement…':editing?'Enregistrer':'Publier'}</button>{editing&&<button type="button" className="ghost-button" onClick={reset}>Annuler</button>}</div>
   </form></div>
  <div className="text-panel" style={{marginTop:'1.25rem'}}><h2>{type==='news'?'Actualités':'Événements'} enregistrés</h2>{recent.length===0?<div className="empty-state">Aucune publication.</div>:<div className="document-list">{recent.map(item=><article className="document-row" key={item.id}><div><h3>{item.title}</h3><p><span className="role-badge">{audienceLabels[item.audience]||'Tout le monde'}</span></p><small>{type==='events'&&item.starts_at?new Date(item.starts_at).toLocaleString('fr-FR'):new Date(item.publish_at||item.created_at).toLocaleString('fr-FR')}</small></div><div style={{display:'flex',gap:'.5rem',flexWrap:'wrap'}}><button type="button" className="ghost-button" onClick={()=>beginEdit(item)}>Modifier</button><button type="button" className="ghost-button" onClick={()=>removeItem(item)}>Supprimer</button></div></article>)}</div>}</div>
 </>
}
