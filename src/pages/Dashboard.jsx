import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { resolvePrivateMedia } from '../lib/mediaStorage.js'
import '../extra.css'
import '../home-refactor.css'
import '../polls-bureau.css'

const formatDate=value=>new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})
const trimText=(value,max=150)=>{const text=String(value||'').trim();return text.length>max?`${text.slice(0,max).trim()}…`:text}

export default function Dashboard(){
 const {profile,isAdmin,user}=useAuth()
 const [news,setNews]=useState([]),[events,setEvents]=useState([]),[bureau,setBureau]=useState([]),[loading,setLoading]=useState(true)
 const [detail,setDetail]=useState(null),[editingRole,setEditingRole]=useState(null),[bureauName,setBureauName]=useState(''),[savingBureau,setSavingBureau]=useState(false),[error,setError]=useState('')

 const load=async()=>{
  setLoading(true);const since=new Date(Date.now()-75*24*60*60*1000).toISOString()
  const [newsResult,eventResult,bureauResult]=await Promise.all([
   supabase.from('news').select('*').eq('published',true).order('publish_at',{ascending:false}).limit(6),
   supabase.from('events').select('*').gte('starts_at',since).order('starts_at',{ascending:true}).limit(12),
   supabase.from('bureau_members').select('role_key,role_label,full_name,sort_order').order('sort_order'),
  ])
  if(newsResult.error)setError(newsResult.error.message);if(eventResult.error)setError(eventResult.error.message);if(bureauResult.error)setError(bureauResult.error.message)
  const newsRows=newsResult.data||[],eventRows=eventResult.data||[],eventIds=eventRows.map(x=>x.id)
  const [newsAssets,eventAssets,galleryCountResult,galleryImagesResult]=await Promise.all([
   newsRows.length?supabase.from('content_attachments').select('*').in('news_id',newsRows.map(x=>x.id)):Promise.resolve({data:[]}),
   eventIds.length?supabase.from('content_attachments').select('*').in('event_id',eventIds).eq('is_cover',true):Promise.resolve({data:[]}),
   eventIds.length?supabase.from('gallery').select('event_id').in('event_id',eventIds):Promise.resolve({data:[]}),
   eventIds.length?supabase.from('gallery').select('id,event_id,media_type,mime_type,storage_provider,storage_path,image_url,title,taken_at').in('event_id',eventIds).eq('media_type','image').order('created_at',{ascending:false}).limit(40):Promise.resolve({data:[]}),
  ])
  const resolvedNewsAssets=await Promise.all((newsAssets.data||[]).map(async a=>({...a,url:await resolvePrivateMedia(a,{entity:'attachment',fallbackBucket:'content'})})))
  const resolvedEventAssets=await Promise.all((eventAssets.data||[]).map(async a=>({...a,url:await resolvePrivateMedia(a,{entity:'attachment',fallbackBucket:'content'})})))
  const resolvedGalleryImages=await Promise.all((galleryImagesResult.data||[]).map(async a=>({...a,url:await resolvePrivateMedia(a,{entity:'gallery',fallbackBucket:'gallery'})})))
  const counts={};(galleryCountResult.data||[]).forEach(row=>{if(row.event_id)counts[row.event_id]=(counts[row.event_id]||0)+1})
  setNews(newsRows.map(item=>{const assets=resolvedNewsAssets.filter(a=>a.news_id===item.id);return{...item,assets,cover:assets.find(a=>a.is_cover)?.url||null}}))
  setEvents(eventRows.map(item=>{const explicit=resolvedEventAssets.find(a=>a.event_id===item.id)?.url||null,album=resolvedGalleryImages.filter(a=>a.event_id===item.id&&a.url);return{...item,cover:explicit||album[0]?.url||null,albumPreview:album.slice(0,4),mediaCount:counts[item.id]||0}}))
  setBureau(bureauResult.data||[]);setLoading(false)
 }
 useEffect(()=>{load()},[])

 const fullName=(profile?.full_name||'').trim(),now=Date.now()
 const future=useMemo(()=>events.filter(e=>new Date(e.starts_at).getTime()>=now).slice(0,4),[events,now])
 const recent=useMemo(()=>events.filter(e=>new Date(e.starts_at).getTime()<now).sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at)).slice(0,4),[events,now])
 const openDetail=(kind,item)=>setDetail({kind,item})
 const keyOpen=(e,kind,item)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDetail(kind,item)}}
 const editBureau=member=>{if(!isAdmin)return;setEditingRole(member.role_key);setBureauName(member.full_name||'')}
 const saveBureau=async member=>{setSavingBureau(true);const {error:updateError}=await supabase.from('bureau_members').update({full_name:bureauName.trim()||null,updated_at:new Date().toISOString(),updated_by:user.id}).eq('role_key',member.role_key);if(updateError)setError(updateError.message);else{setEditingRole(null);setBureauName('');await load()}setSavingBureau(false)}

 const EventTile=({event})=><article className="home-editorial-card home-event-tile" role="button" tabIndex="0" onClick={()=>openDetail('event',event)} onKeyDown={e=>keyOpen(e,'event',event)}>
   <div className="home-tile-media">{event.cover?<img src={event.cover} alt="" loading="lazy"/>:<div className="home-tile-placeholder">📅</div>}{event.mediaCount>0&&<span className="home-album-badge">📷 {event.mediaCount}</span>}</div>
   <div className="home-tile-body"><time>{formatDate(event.starts_at)} · {new Date(event.starts_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</time><h3>{event.title}</h3>{event.location&&<p className="home-tile-location">📍 {event.location}</p>}<p>{trimText(event.description,115)||'Ouvrez la tuile pour consulter les détails.'}</p><span className="home-tile-more">Voir les détails →</span></div>
  </article>

 return <div className="home-dashboard">
  <section className="home-welcome"><div className="home-welcome-copy"><span className="eyebrow">Amicale DANZ Antilles</span><h1>{fullName?`Bonjour ${fullName}`:'Bienvenue !'}</h1><p>Actualités, prochains rendez-vous et souvenirs récents sont visibles directement sur votre page d’accueil.</p></div><img className="home-welcome-logo" src="/danz/amicale-danz-icon.png" alt="Insigne DANZ Antilles"/></section>
  {isAdmin&&<section className="home-admin-banner"><div><strong>Espace administrateur</strong><span>Publiez rapidement une actualité ou un événement avec photo et pièces jointes.</span></div><Link to="/administration/contenus">＋ Publier</Link></section>}
  {error&&<div className="alert error">{error}</div>}

  <section className="home-live-section"><div className="home-section-title"><div><span className="eyebrow">Informations</span><h2>Actualités</h2></div><p>Appuyez sur une tuile pour lire l’information complète.</p></div>
   {loading?<div className="skeleton-card tall"/>:news.length?<div className="home-editorial-grid">{news.map(item=><article className="home-editorial-card" key={item.id} role="button" tabIndex="0" onClick={()=>openDetail('news',item)} onKeyDown={e=>keyOpen(e,'news',item)}><div className="home-tile-media">{item.cover?<img src={item.cover} alt="" loading="lazy"/>:<div className="home-tile-placeholder">📣</div>}</div><div className="home-tile-body"><time>{formatDate(item.publish_at||item.published_at)}</time><h3>{item.title}</h3><p>{trimText(item.summary||item.content,145)||'Ouvrez la tuile pour lire cette information.'}</p>{item.assets.filter(a=>!a.is_cover).length>0&&<span className="home-file-badge">📎 {item.assets.filter(a=>!a.is_cover).length} pièce{item.assets.filter(a=>!a.is_cover).length>1?'s':''} jointe{item.assets.filter(a=>!a.is_cover).length>1?'s':''}</span>}<span className="home-tile-more">Lire la suite →</span></div></article>)}</div>:<div className="empty-state">Aucune actualité publiée pour le moment.</div>}
  </section>

  <section className="home-live-section"><div className="home-section-title"><div><span className="eyebrow">À venir</span><h2>Prochains événements</h2></div><Link className="home-more" to="/agenda">Agenda complet →</Link></div>{loading?<div className="skeleton-card tall"/>:future.length?<div className="home-editorial-grid">{future.map(event=><EventTile key={event.id} event={event}/>)}</div>:<div className="empty-state">Aucun événement à venir.</div>}</section>

  <section className="home-live-section"><div className="home-section-title"><div><span className="eyebrow">Souvenirs</span><h2>Événements récents</h2></div><p>Les photos d’album servent automatiquement d’illustration lorsqu’elles existent.</p></div>{loading?<div className="skeleton-card tall"/>:recent.length?<div className="home-editorial-grid">{recent.map(event=><EventTile key={event.id} event={event}/>)}</div>:<div className="empty-state">Aucun événement récent.</div>}</section>

  <section><div className="home-section-title"><div><span className="eyebrow">Accès rapide</span><h2>Les autres espaces</h2></div></div><div className="home-shortcuts" style={{marginTop:'16px'}}><Link className="home-shortcut" to="/agenda"><span className="home-shortcut-icon">📅</span><strong>Agenda</strong><span>Tous les rendez-vous et ajout au calendrier.</span></Link><Link className="home-shortcut" to="/sondages"><span className="home-shortcut-icon">✓</span><strong>Sondages</strong><span>Votez pour les futures activités.</span></Link><Link className="home-shortcut" to="/bons-plans"><span className="home-shortcut-icon">⭐</span><strong>Bons plans</strong><span>Adresses et avantages en Martinique.</span></Link><Link className="home-shortcut" to="/galerie"><span className="home-shortcut-icon">📷</span><strong>Galerie</strong><span>Albums photos et vidéos des événements.</span></Link></div></section>

  <section className="home-amicale-section"><div className="home-section-title"><div><span className="eyebrow">Qui sommes-nous ?</span><h2>L’Amicale DANZ Antilles</h2></div></div><div className="text-panel"><p><span className="role-badge">Depuis début 2025 · Association loi 1901</span></p><p>Créée au début de l’année 2025, l’Amicale DANZ Antilles est une association régie par la loi du 1er juillet 1901. Elle a pour vocation de créer du lien entre les membres, de faciliter le partage d’informations et d’initiatives, et d’organiser des moments conviviaux, culturels, sportifs, familiaux ou festifs.</p></div><div className="text-panel bureau-panel"><div className="bureau-heading"><div><span className="eyebrow">Organisation</span><h2>Membres du bureau</h2></div>{isAdmin&&<small>Appuyez sur une fonction pour modifier le nom.</small>}</div><div className="bureau-grid">{bureau.map(member=><article className={`bureau-card ${isAdmin?'bureau-card-editable':''}`} key={member.role_key} onClick={()=>editBureau(member)}>{editingRole===member.role_key?<div className="bureau-edit" onClick={e=>e.stopPropagation()}><span>{member.role_label}</span><input autoFocus value={bureauName} onChange={e=>setBureauName(e.target.value)} placeholder="Prénom Nom"/><div><button type="button" className="secondary-button" disabled={savingBureau} onClick={()=>saveBureau(member)}>{savingBureau?'Enregistrement…':'Enregistrer'}</button><button type="button" className="ghost-button" onClick={()=>setEditingRole(null)}>Annuler</button></div></div>:<><span className="bureau-role">{member.role_label}</span><strong>{member.full_name||'À renseigner'}</strong>{isAdmin&&<small>✏️ Modifier</small>}</>}</article>)}</div></div></section>

  {detail&&<div className="home-detail-backdrop" role="presentation" onClick={()=>setDetail(null)}><section className="home-detail-modal" role="dialog" aria-modal="true" aria-label={detail.item.title} onClick={e=>e.stopPropagation()}><button type="button" className="home-detail-close" aria-label="Fermer" onClick={()=>setDetail(null)}>×</button>{detail.item.cover&&<img className="home-detail-cover" src={detail.item.cover} alt=""/>}<div className="home-detail-content"><span className="eyebrow">{detail.kind==='news'?'Actualité':new Date(detail.item.starts_at).getTime()>=Date.now()?'Événement à venir':'Événement récent'}</span><h2>{detail.item.title}</h2>{detail.kind==='news'?<><time>{formatDate(detail.item.publish_at||detail.item.published_at)}</time>{detail.item.content&&<p className="home-detail-text">{detail.item.content}</p>}{detail.item.assets.filter(a=>!a.is_cover).length>0&&<div className="home-detail-files"><strong>Pièces jointes</strong>{detail.item.assets.filter(a=>!a.is_cover).map(a=><a key={a.id} href={a.url||'#'} target="_blank" rel="noopener noreferrer">📎 {a.file_name}</a>)}</div>}</>:<><p className="home-detail-meta">📅 {formatDate(detail.item.starts_at)} · {new Date(detail.item.starts_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</p>{detail.item.location&&<p className="home-detail-meta">📍 {detail.item.location}</p>}{detail.item.description&&<p className="home-detail-text">{detail.item.description}</p>}{detail.item.albumPreview?.length>0&&<div className="home-album-preview">{detail.item.albumPreview.map(media=><img key={media.id} src={media.url} alt=""/>)}</div>}{detail.item.mediaCount>0&&<Link className="primary-button home-detail-album-link" to={`/galerie?event=${detail.item.id}`} onClick={()=>setDetail(null)}>📷 Ouvrir l’album complet ({detail.item.mediaCount})</Link>}</>}</div></section></div>}
 </div>
}
