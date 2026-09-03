import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { resolvePrivateMedia } from '../lib/mediaStorage.js'
import '../extra.css'
import '../home-refactor.css'
import '../polls-bureau.css'

const formatDate=(value)=>new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})

export default function Dashboard(){
 const {profile,isAdmin,user}=useAuth()
 const [news,setNews]=useState([])
 const [events,setEvents]=useState([])
 const [bureau,setBureau]=useState([])
 const [loading,setLoading]=useState(true)
 const [editingRole,setEditingRole]=useState(null)
 const [bureauName,setBureauName]=useState('')
 const [savingBureau,setSavingBureau]=useState(false)
 const [error,setError]=useState('')

 const load=async()=>{
  setLoading(true)
  const since=new Date(Date.now()-45*24*60*60*1000).toISOString()
  const [newsResult,eventResult,bureauResult]=await Promise.all([
   supabase.from('news').select('*').eq('published',true).order('publish_at',{ascending:false}).limit(5),
   supabase.from('events').select('*').gte('starts_at',since).order('starts_at',{ascending:true}).limit(10),
   supabase.from('bureau_members').select('role_key,role_label,full_name,sort_order').order('sort_order'),
  ])
  if(newsResult.error)setError(newsResult.error.message)
  if(eventResult.error)setError(eventResult.error.message)
  if(bureauResult.error)setError(bureauResult.error.message)
  const newsRows=newsResult.data||[],eventRows=eventResult.data||[]
  const [newsAssets,eventAssets]=await Promise.all([
   newsRows.length?supabase.from('content_attachments').select('*').in('news_id',newsRows.map(x=>x.id)):Promise.resolve({data:[]}),
   eventRows.length?supabase.from('content_attachments').select('*').in('event_id',eventRows.map(x=>x.id)):Promise.resolve({data:[]}),
  ])
  const resolvedNewsAssets=await Promise.all((newsAssets.data||[]).map(async a=>({...a,url:await resolvePrivateMedia(a,{entity:'attachment',fallbackBucket:'content'})})))
  const resolvedEventAssets=await Promise.all((eventAssets.data||[]).map(async a=>({...a,url:await resolvePrivateMedia(a,{entity:'attachment',fallbackBucket:'content'})})))
  setNews(newsRows.map(item=>({...item,assets:resolvedNewsAssets.filter(a=>a.news_id===item.id),cover:resolvedNewsAssets.find(a=>a.news_id===item.id&&a.is_cover)?.url||null})))
  setEvents(eventRows.map(item=>({...item,cover:resolvedEventAssets.find(a=>a.event_id===item.id&&a.is_cover)?.url||null})))
  setBureau(bureauResult.data||[])
  setLoading(false)
 }
 useEffect(()=>{load()},[])

 const fullName=(profile?.full_name||'').trim()
 const now=Date.now()
 const future=useMemo(()=>events.filter(e=>new Date(e.starts_at).getTime()>=now).slice(0,5),[events,now])
 const recent=useMemo(()=>events.filter(e=>new Date(e.starts_at).getTime()<now).sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at)).slice(0,2),[events,now])

 const editBureau=(member)=>{if(!isAdmin)return;setEditingRole(member.role_key);setBureauName(member.full_name||'')}
 const saveBureau=async(member)=>{setSavingBureau(true);const {error:updateError}=await supabase.from('bureau_members').update({full_name:bureauName.trim()||null,updated_at:new Date().toISOString(),updated_by:user.id}).eq('role_key',member.role_key);if(updateError)setError(updateError.message);else{setEditingRole(null);setBureauName('');await load()}setSavingBureau(false)}

 return <div className="home-dashboard">
  <section className="home-welcome"><div className="home-welcome-copy"><span className="eyebrow">Amicale DANZ Antilles</span><h1>{fullName?`Bonjour ${fullName}`:'Bienvenue !'}</h1><p>Retrouvez ici les informations de l’Amicale et de la DANZ, les prochains rendez-vous et les dernières nouvelles sans avoir à parcourir plusieurs rubriques.</p></div><img className="home-welcome-logo" src="/danz/amicale-danz-icon.png" alt="Insigne DANZ Antilles"/></section>

  {isAdmin&&<section className="home-admin-banner"><div><strong>Espace administrateur</strong><span>Publiez rapidement une actualité ou un événement, avec photo et pièces jointes.</span></div><Link to="/administration/contenus">＋ Publier</Link></section>}
  {error&&<div className="alert error">{error}</div>}

  <section className="home-live-section">
   <div className="home-section-title"><div><span className="eyebrow">Informations</span><h2>Actualités</h2></div><p>Les dernières informations sont directement visibles ici.</p></div>
   {loading?<div className="skeleton-card tall"/>:news.length?<div className="home-news-feed">{news.map(item=><article className="home-news-card" key={item.id}>
    {item.cover&&<img className="home-content-cover" src={item.cover} alt="" loading="lazy"/>}
    <div className="home-news-body"><time>{formatDate(item.publish_at||item.published_at)}</time><h3>{item.title}</h3>{item.content&&<p>{item.content}</p>}
     {item.assets.filter(a=>!a.is_cover).length>0&&<div className="home-attachments"><strong>Pièces jointes</strong>{item.assets.filter(a=>!a.is_cover).map(a=><a key={a.id} href={a.url||'#'} target="_blank" rel="noopener noreferrer" className={!a.url?'disabled':''}>📎 {a.file_name}</a>)}</div>}
    </div>
   </article>)}</div>:<div className="empty-state">Aucune actualité publiée pour le moment.</div>}
  </section>

  <section className="home-live-section">
   <div className="home-section-title"><div><span className="eyebrow">Vie de l’amicale</span><h2>Événements à venir</h2></div><Link className="home-more" to="/agenda">Agenda complet →</Link></div>
   {loading?<div className="skeleton-card tall"/>:future.length?<div className="home-events-grid">{future.map(event=><article className="home-event-card" key={event.id}>{event.cover&&<img className="home-content-cover" src={event.cover} alt="" loading="lazy"/>}<div><time>{formatDate(event.starts_at)} · {new Date(event.starts_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</time><h3>{event.title}</h3>{event.location&&<p>📍 {event.location}</p>}{event.description&&<p>{event.description}</p>}<Link to="/agenda">Voir dans l’agenda →</Link></div></article>)}</div>:<div className="empty-state">Aucun événement à venir.</div>}
   {recent.length>0&&<details className="home-recent-events"><summary>Voir les événements récents ({recent.length})</summary><div className="home-events-grid">{recent.map(event=><article className="home-event-card compact" key={event.id}>{event.cover&&<img className="home-content-cover" src={event.cover} alt="" loading="lazy"/>}<div><time>{formatDate(event.starts_at)}</time><h3>{event.title}</h3>{event.location&&<p>📍 {event.location}</p>}</div></article>)}</div></details>}
  </section>

  <section><div className="home-section-title"><div><span className="eyebrow">Accès rapide</span><h2>Les autres espaces</h2></div></div><div className="home-shortcuts" style={{marginTop:'16px'}}>
   <Link className="home-shortcut" to="/agenda"><span className="home-shortcut-icon">📅</span><strong>Agenda</strong><span>Tous les rendez-vous et ajout au calendrier.</span></Link>
   <Link className="home-shortcut" to="/sondages"><span className="home-shortcut-icon">✓</span><strong>Sondages</strong><span>Votez pour les futures activités.</span></Link>
   <Link className="home-shortcut" to="/bons-plans"><span className="home-shortcut-icon">⭐</span><strong>Bons plans</strong><span>Adresses et avantages en Martinique.</span></Link>
   <Link className="home-shortcut" to="/galerie"><span className="home-shortcut-icon">📷</span><strong>Galerie</strong><span>Photos et vidéos classées par événement.</span></Link>
  </div></section>

  <section className="home-amicale-section">
   <div className="home-section-title"><div><span className="eyebrow">Qui sommes-nous ?</span><h2>L’Amicale DANZ Antilles</h2></div></div>
   <div className="text-panel"><p><span className="role-badge">Depuis début 2025 · Association loi 1901</span></p><p>Créée au début de l’année 2025, l’Amicale DANZ Antilles est une association régie par la loi du 1er juillet 1901. Elle a pour vocation de créer du lien entre les membres, de faciliter le partage d’informations et d’initiatives, et d’organiser des moments conviviaux, culturels, sportifs, familiaux ou festifs.</p></div>
   <div className="text-panel bureau-panel"><div className="bureau-heading"><div><span className="eyebrow">Organisation</span><h2>Membres du bureau</h2></div>{isAdmin&&<small>Appuyez sur une fonction pour modifier le nom.</small>}</div><div className="bureau-grid">{bureau.map(member=><article className={`bureau-card ${isAdmin?'bureau-card-editable':''}`} key={member.role_key} onClick={()=>editBureau(member)}>{editingRole===member.role_key?<div className="bureau-edit" onClick={e=>e.stopPropagation()}><span>{member.role_label}</span><input autoFocus value={bureauName} onChange={e=>setBureauName(e.target.value)} placeholder="Prénom Nom"/><div><button type="button" className="secondary-button" disabled={savingBureau} onClick={()=>saveBureau(member)}>{savingBureau?'Enregistrement…':'Enregistrer'}</button><button type="button" className="ghost-button" onClick={()=>setEditingRole(null)}>Annuler</button></div></div>:<><span className="bureau-role">{member.role_label}</span><strong>{member.full_name||'À renseigner'}</strong>{isAdmin&&<small>✏️ Modifier</small>}</>}</article>)}</div></div>
  </section>
 </div>
}
