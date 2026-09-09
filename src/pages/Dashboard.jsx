import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { resolvePrivateMediaBatch } from '../lib/mediaStorage.js'
import { readOfflineData, saveOfflineData } from '../lib/offlineCache.js'
import '../extra.css'
import '../home-refactor.css'
import '../polls-bureau.css'

const formatDate=value=>new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})
const trimText=(value,max=120)=>{const text=String(value||'').trim();return text.length>max?`${text.slice(0,max).trim()}…`:text}
const isAlbumExpired=album=>Boolean(album?.transfer_expires_at&&new Date(album.transfer_expires_at).getTime()<Date.now())

export default function Dashboard(){
 const {profile,user}=useAuth()
 const [news,setNews]=useState([]),[events,setEvents]=useState([]),[bureau,setBureau]=useState([]),[loading,setLoading]=useState(true)
 const [detail,setDetail]=useState(null),[error,setError]=useState(''),[clock,setClock]=useState(()=>Date.now())

 const useCached=()=>{
  const cached=readOfflineData(user?.id,'dashboard')
  if(!cached)return false
  setNews(cached.news||[]);setEvents(cached.events||[]);setBureau(cached.bureau||[])
  setError('Mode hors ligne · affichage de la dernière copie enregistrée sur cet appareil.')
  setLoading(false)
  return true
 }

 const load=async()=>{
  setLoading(true);setError('')
  if(!navigator.onLine){if(!useCached()){setError('Aucune copie hors ligne de l’accueil n’est encore disponible sur cet appareil.');setLoading(false)};return}

  const now=Date.now(),since=new Date(now-75*24*60*60*1000).toISOString()
  const [newsResult,eventResult,bureauResult]=await Promise.all([
   supabase.from('news').select('*').eq('published',true).order('publish_at',{ascending:false}).limit(6),
   supabase.from('events').select('*').gte('starts_at',since).order('starts_at',{ascending:true}).limit(12),
   supabase.from('bureau_members').select('role_key,role_label,full_name,sort_order').order('sort_order'),
  ])

  const primaryErrors=[newsResult.error,eventResult.error,bureauResult.error].filter(Boolean)
  if(primaryErrors.some(err=>/fetch|network|failed/i.test(String(err?.message||'')))&&useCached())return
  if(primaryErrors.length)setError('Certaines informations de l’accueil n’ont pas pu être actualisées. Réessayez dans quelques instants.')

  const newsRows=newsResult.data||[],eventRows=eventResult.data||[],eventIds=eventRows.map(x=>x.id)
  const [newsAssetsResult,eventAssetsResult,albumsResult]=await Promise.all([
   newsRows.length?supabase.from('content_attachments').select('*').in('news_id',newsRows.map(x=>x.id)):Promise.resolve({data:[],error:null}),
   eventIds.length?supabase.from('content_attachments').select('*').in('event_id',eventIds).eq('is_cover',true):Promise.resolve({data:[],error:null}),
   eventIds.length?supabase.from('event_albums').select('id,event_id,storage_provider,storage_path,image_url,mime_type,file_size,transfer_url,transfer_expires_at,item_count,download_note').in('event_id',eventIds):Promise.resolve({data:[],error:null}),
  ])
  if(!primaryErrors.length&&[newsAssetsResult.error,eventAssetsResult.error,albumsResult.error].some(Boolean))setError('Les informations principales sont disponibles, mais certains médias n’ont pas pu être chargés.')

  const newsAssets=newsAssetsResult.data||[],eventAssets=eventAssetsResult.data||[],albumRows=albumsResult.data||[]
  const newsCoverAssets=newsAssets.filter(asset=>asset.is_cover)
  const [newsUrls,eventUrls,albumUrls]=await Promise.all([
   resolvePrivateMediaBatch(newsCoverAssets,{entity:'attachment',fallbackBucket:'content'}),
   resolvePrivateMediaBatch(eventAssets,{entity:'attachment',fallbackBucket:'content'}),
   resolvePrivateMediaBatch(albumRows,{entity:'album',fallbackBucket:'gallery'}),
  ])
  const explicitByEvent=new Map(eventAssets.map(asset=>[asset.event_id,asset]))
  const albumByEvent=new Map(albumRows.map(album=>[album.event_id,album]))

  const newsState=newsRows.map(item=>{
   const assets=newsAssets.filter(a=>a.news_id===item.id),coverAsset=assets.find(a=>a.is_cover)
   return{...item,assets,cover:coverAsset?(newsUrls.get(coverAsset.id)||null):null}
  })
  const eventsState=eventRows.map(item=>{
   const explicit=explicitByEvent.get(item.id),album=albumByEvent.get(item.id)
   const albumCover=album?(albumUrls.get(album.id)||album.image_url||null):null
   return{...item,cover:(explicit&&eventUrls.get(explicit.id))||albumCover||null,album:album?{...album,cover:albumCover,expired:isAlbumExpired(album)}:null}
  })
  const bureauState=bureauResult.data||[]

  setNews(newsState);setEvents(eventsState);setBureau(bureauState);setClock(Date.now());setLoading(false)
  if(user?.id){
   const safeNews=newsState.map(item=>({...item,cover:null,assets:(item.assets||[]).map(asset=>({...asset,url:undefined}))}))
   const safeEvents=eventsState.map(item=>({...item,cover:null,album:item.album?{...item.album,cover:null}:null}))
   saveOfflineData(user.id,'dashboard',{news:safeNews,events:safeEvents,bureau:bureauState})
  }
 }
 useEffect(()=>{load()},[])
 useEffect(()=>{const timer=window.setInterval(()=>setClock(Date.now()),60000);return()=>window.clearInterval(timer)},[])
 useEffect(()=>{
  if(!detail)return undefined
  const previous=document.body.style.overflow
  document.body.style.overflow='hidden'
  const onKey=e=>{if(e.key==='Escape')setDetail(null)}
  window.addEventListener('keydown',onKey)
  return()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',onKey)}
 },[detail])

 const fullName=(profile?.full_name||'').trim()
 const future=useMemo(()=>events.filter(e=>new Date(e.starts_at).getTime()>=clock).slice(0,4),[events,clock])
 const recent=useMemo(()=>events.filter(e=>new Date(e.starts_at).getTime()<clock).sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at)).slice(0,4),[events,clock])
 const latestNews=news[0]||null,nextEvent=future[0]||null,otherNews=news.slice(1,4),otherFuture=future.slice(1,4)
 const todayLabel=new Date(clock).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})

 const openDetail=async(kind,item)=>{
  const canLoadExtra=navigator.onLine&&kind==='news'
  setDetail({kind,item:{...item},loadingExtra:canLoadExtra,extraError:false})
  if(!canLoadExtra)return
  try{
   const attachments=(item.assets||[]).filter(a=>!a.is_cover)
   const urls=await resolvePrivateMediaBatch(attachments,{entity:'attachment',fallbackBucket:'content'})
   const resolved=(item.assets||[]).map(a=>({...a,url:a.is_cover?item.cover:(urls.get(a.id)||null)}))
   const missing=attachments.some(a=>!urls.get(a.id))
   setDetail(current=>current?.item?.id===item.id?{...current,item:{...current.item,assets:resolved},loadingExtra:false,extraError:missing}:current)
  }catch(_){setDetail(current=>current?.item?.id===item.id?{...current,loadingExtra:false,extraError:true}:current)}
 }
 const keyOpen=(e,kind,item)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDetail(kind,item)}}

 const Tile=({kind,item,compact=false,priority=false})=>{
  const isEvent=kind==='event',date=isEvent?item.starts_at:(item.publish_at||item.published_at)
  const albumLabel=item.album?(item.album.expired?'⏱ Expiré':item.album.item_count!=null?`📷 ${item.album.item_count}`:'📷 Album'):null
  return <article className={`home-editorial-card ${compact?'compact':''}`} role="button" tabIndex="0" onClick={()=>openDetail(kind,item)} onKeyDown={e=>keyOpen(e,kind,item)}>
   <div className="home-tile-media">{item.cover?<img src={item.cover} alt="" loading={priority?'eager':'lazy'} decoding="async" fetchPriority={priority?'high':'auto'}/>:<div className="home-tile-placeholder">{isEvent?'📅':'📣'}</div>}{isEvent&&albumLabel&&<span className="home-album-badge">{albumLabel}</span>}</div>
   <div className="home-tile-body"><time>{formatDate(date)}{isEvent?` · ${new Date(item.starts_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`:''}</time><h3>{item.title}</h3>{isEvent&&item.location&&<p className="home-tile-location">📍 {item.location}</p>}<p>{trimText(isEvent?item.description:(item.summary||item.content),compact?85:105)||'Ouvrez la tuile pour consulter les détails.'}</p>{!isEvent&&item.assets?.filter(a=>!a.is_cover).length>0&&<span className="home-file-badge">📎 {item.assets.filter(a=>!a.is_cover).length}</span>}<span className="home-tile-more">Voir les détails →</span></div>
  </article>
 }

 return <div className="home-dashboard home-dashboard-compact home-app-dashboard">
  <section className="home-app-header"><div className="home-app-header-copy"><span className="home-app-date">{todayLabel}</span><span className="eyebrow">Amicale DANZ Antilles</span><h1>{fullName?`Bonjour ${fullName}`:'Bienvenue'}</h1><p>Actualités, rendez-vous et souvenirs de l’Amicale.</p><div className="home-app-status-row">{nextEvent&&<span>📅 Prochain rendez-vous : {formatDate(nextEvent.starts_at)}</span>}{latestNews&&<span>● Informations à jour</span>}</div></div><img className="home-app-mark" src="/danz/amicale-danz-icon.png" alt="Insigne DANZ Antilles"/></section>

  <nav className="home-app-actions" aria-label="Raccourcis"><Link to="/agenda"><span>📅</span><strong>Agenda</strong></Link><Link to="/sondages"><span>✓</span><strong>Sondages</strong></Link><Link to="/bons-plans"><span>★</span><strong>Bons plans</strong></Link><Link to="/galerie"><span>▦</span><strong>Albums</strong></Link></nav>

  {error&&<div className={`alert ${error.startsWith('Mode hors ligne')?'warning':'error'}`}>{error}</div>}

  <section className="home-live-section home-spotlight-section"><div className="home-section-title"><div><span className="eyebrow">Aujourd’hui</span><h2>L’essentiel</h2></div></div>
   {loading?<div className="skeleton-card tall"/>:<div className="home-spotlight-grid">{latestNews?<Tile kind="news" item={latestNews} priority/>:<div className="empty-state">Aucune actualité publiée.</div>}{nextEvent?<Tile kind="event" item={nextEvent} priority/>:<div className="empty-state">Aucun événement à venir.</div>}</div>}
  </section>

  {otherNews.length>0&&<section className="home-live-section"><div className="home-section-title"><div><span className="eyebrow">Informations</span><h2>Actualités récentes</h2></div></div><div className="home-editorial-grid compact-grid">{otherNews.map(item=><Tile key={item.id} kind="news" item={item} compact/>)}</div></section>}
  {otherFuture.length>0&&<section className="home-live-section"><div className="home-section-title"><div><span className="eyebrow">À venir</span><h2>Autres événements</h2></div><Link className="home-more" to="/agenda">Agenda complet →</Link></div><div className="home-editorial-grid compact-grid">{otherFuture.map(event=><Tile key={event.id} kind="event" item={event} compact/>)}</div></section>}
  <section className="home-live-section"><div className="home-section-title"><div><span className="eyebrow">Souvenirs</span><h2>Événements récents</h2></div><Link className="home-more" to="/galerie">Tous les albums →</Link></div>{loading?<div className="skeleton-card tall"/>:recent.length?<div className="home-editorial-grid compact-grid">{recent.map(event=><Tile key={event.id} kind="event" item={event} compact/>)}</div>:<div className="empty-state">Aucun événement récent.</div>}</section>

  <section className="home-amicale-section"><div className="home-section-title"><div><span className="eyebrow">L’Amicale</span><h2>DANZ Antilles</h2></div></div><div className="text-panel"><p><span className="role-badge">Depuis début 2025 · Association loi 1901</span></p><p>Créée au début de l’année 2025, l’Amicale DANZ Antilles a pour vocation de créer du lien entre les membres, partager les informations utiles et organiser des moments conviviaux, culturels, sportifs, familiaux ou festifs.</p></div><div className="text-panel bureau-panel"><div className="bureau-heading"><div><span className="eyebrow">Organisation</span><h2>Membres du bureau</h2></div></div><div className="bureau-grid">{bureau.map(member=><article className="bureau-card" key={member.role_key}><span className="bureau-role">{member.role_label}</span><strong>{member.full_name||'À renseigner'}</strong></article>)}</div></div></section>

  {detail&&<div className="home-detail-backdrop" role="presentation" onClick={()=>setDetail(null)}><section className="home-detail-modal" role="dialog" aria-modal="true" aria-label={detail.item.title} onClick={e=>e.stopPropagation()}><button type="button" className="home-detail-close" aria-label="Fermer" onClick={()=>setDetail(null)}>×</button>{detail.item.cover&&<img className="home-detail-cover" src={detail.item.cover} alt="" decoding="async"/>}<div className="home-detail-content"><span className="eyebrow">{detail.kind==='news'?'Actualité':new Date(detail.item.starts_at).getTime()>=clock?'Événement à venir':'Événement récent'}</span><h2>{detail.item.title}</h2>{detail.kind==='news'?<><time>{formatDate(detail.item.publish_at||detail.item.published_at)}</time>{detail.item.content&&<p className="home-detail-text">{detail.item.content}</p>}{detail.loadingExtra&&detail.item.assets?.some(a=>!a.is_cover)&&<p className="home-detail-loading">Chargement des pièces jointes…</p>}{navigator.onLine&&!detail.loadingExtra&&detail.item.assets?.filter(a=>!a.is_cover&&a.url).length>0&&<div className="home-detail-files"><strong>Pièces jointes</strong>{detail.item.assets.filter(a=>!a.is_cover&&a.url).map(a=><a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer">📎 {a.file_name}</a>)}</div>}{detail.extraError&&<p className="home-detail-loading">Une ou plusieurs pièces jointes sont temporairement indisponibles.</p>}</>:<><p className="home-detail-meta">📅 {formatDate(detail.item.starts_at)} · {new Date(detail.item.starts_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</p>{detail.item.location&&<p className="home-detail-meta">📍 {detail.item.location}</p>}{detail.item.description&&<p className="home-detail-text">{detail.item.description}</p>}{detail.item.album&&<><div className="home-album-summary"><span>📷</span><div><strong>{detail.item.album.expired?'Lien de l’album expiré':detail.item.album.transfer_url?'Album disponible':'Miniature de l’album'}</strong><small>{detail.item.album.expired?'Le téléchargement complet n’est plus accessible.':detail.item.album.item_count!=null?`${detail.item.album.item_count} média${detail.item.album.item_count>1?'s':''}`:'Souvenir de l’événement'}</small></div></div>{navigator.onLine?<Link className="primary-button home-detail-album-link" to={`/galerie?event=${detail.item.id}`} onClick={()=>setDetail(null)}>{detail.item.album.expired?'Voir la miniature →':'Ouvrir l’album →'}</Link>:<p className="home-detail-loading">Le téléchargement de l’album nécessite une connexion Internet.</p>}</>}</>}</div></section></div>}
 </div>
}
