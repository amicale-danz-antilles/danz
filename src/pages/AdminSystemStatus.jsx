import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { readOfflineEntry } from '../lib/offlineCache.js'
import { PageTitle } from './Actualites.jsx'
import '../system-status.css'

const formatBytes=value=>{
  const bytes=Number(value||0)
  if(bytes<1024)return `${bytes} o`
  const units=['Ko','Mo','Go','To'];let size=bytes/1024,index=0
  while(size>=1024&&index<units.length-1){size/=1024;index+=1}
  return `${size.toLocaleString('fr-FR',{maximumFractionDigits:size<10?2:1})} ${units[index]}`
}
const formatDate=value=>value?new Date(value).toLocaleString('fr-FR'):'Jamais'

export default function AdminSystemStatus(){
  const {user,isAdmin,loading:authLoading}=useAuth()
  const [data,setData]=useState(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const offlineEntry=readOfflineEntry(user?.id,'offline-sync')

  const load=async()=>{
    setLoading(true);setError('')
    const {data:result,error:fnError}=await supabase.functions.invoke('admin-system-status',{body:{action:'status'}})
    if(fnError||result?.error)setError(result?.error||fnError?.message||'État du système indisponible.')
    else setData(result)
    setLoading(false)
  }
  useEffect(()=>{if(isAdmin)load();else if(!authLoading)setLoading(false)},[isAdmin,authLoading])
  if(!authLoading&&!isAdmin)return <Navigate to="/" replace/>

  const warnings=useMemo(()=>{
    if(!data)return []
    const list=[]
    if(!data.services?.r2?.ok)list.push('Le stockage R2 n’est pas configuré ou n’est pas visible par les fonctions serveur.')
    if(!data.backup)list.push('Aucune sauvegarde structurée n’est enregistrée dans le journal d’administration.')
    else if(Date.now()-new Date(data.backup.created_at).getTime()>7*24*60*60*1000)list.push('La dernière sauvegarde enregistrée a plus de 7 jours.')
    if(Number(data.users?.pending_requests||0)>0)list.push(`${data.users.pending_requests} demande${data.users.pending_requests>1?'s':''} d’accès en attente.`)
    if(Number(data.content?.legacy_gallery_items||0)>0)list.push(`${data.content.legacy_gallery_items} ancien${data.content.legacy_gallery_items>1?'s':''} média${data.content.legacy_gallery_items>1?'s':''} reste${data.content.legacy_gallery_items>1?'nt':''} indexé${data.content.legacy_gallery_items>1?'s':''} dans l’ancienne Galerie.`)
    return list
  },[data])

  return <div className="system-status-page">
    <PageTitle eyebrow="Administration · Supervision" title="État du système" text="Contrôlez en un coup d’œil les services, les utilisateurs, les volumes de données, les sauvegardes et la préparation du mode hors ligne."/>
    <div className="system-status-actions"><Link className="ghost-button" to="/administration">← Administration</Link><button className="secondary-button" onClick={load} disabled={loading}>{loading?'Vérification…':'↻ Actualiser'}</button></div>
    {error&&<div className="alert error">{error}</div>}
    {loading&&!data?<div className="skeleton-card tall"/>:data&&<>
      <section><div className="admin-section-heading"><div><span className="eyebrow">Santé technique</span><h2>Services essentiels</h2></div><small>Contrôle : {formatDate(data.checked_at)}</small></div><div className="system-service-grid">{Object.entries(data.services||{}).map(([key,service])=><article key={key} className={service.ok?'ok':'warning'}><span className="system-state-dot"/><div><strong>{service.label}</strong><small>{service.ok?'Opérationnel':'Attention requise'}</small></div></article>)}</div></section>

      {warnings.length>0&&<section className="system-warning-panel"><strong>Points à surveiller</strong>{warnings.map(item=><p key={item}>• {item}</p>)}</section>}

      <section><div className="admin-section-heading"><div><span className="eyebrow">Accès</span><h2>Utilisateurs</h2></div></div><div className="system-metric-grid"><Metric value={data.users?.total} label="comptes enregistrés"/><Metric value={data.users?.active} label="accès actifs"/><Metric value={data.users?.suspended} label="comptes suspendus"/><Metric value={data.users?.pending_requests} label="demandes en attente"/></div></section>

      <section><div className="admin-section-heading"><div><span className="eyebrow">Contenu</span><h2>Inventaire des données</h2></div></div><div className="system-metric-grid compact"><Metric value={data.content?.news} label="actualités"/><Metric value={data.content?.events} label="événements"/><Metric value={data.content?.good_deals} label="bons plans"/><Metric value={data.content?.polls} label="sondages"/><Metric value={data.content?.albums} label="albums légers"/><Metric value={data.content?.attachments} label="pièces jointes"/></div></section>

      <section className="system-two-column"><article className="system-panel"><span className="eyebrow">Stockage</span><h2>{formatBytes(data.storage?.indexed_bytes)}</h2><p>Volume connu des fichiers référencés dans la base, pour {data.storage?.indexed_files||0} fichier{data.storage?.indexed_files===1?'':'s'}.</p><div className="system-provider-list">{Object.entries(data.storage?.providers||{}).map(([provider,count])=><span key={provider}><strong>{provider.toUpperCase()}</strong>{count} fichier{count===1?'':'s'}</span>)}</div><small>Les albums WeTransfer externes ne sont pas comptés dans ce volume.</small></article>
        <article className="system-panel"><span className="eyebrow">Sauvegarde</span><h2>{data.backup?'Sauvegarde tracée':'À effectuer'}</h2><p>{data.backup?`Dernier export enregistré le ${formatDate(data.backup.created_at)}.`:'Aucune sauvegarde n’apparaît encore dans le journal serveur.'}</p><Link className="secondary-button system-panel-link" to="/administration/sauvegardes">Ouvrir Sauvegardes & exports →</Link></article></section>

      <section className="system-panel offline-system-panel"><span className="eyebrow">Continuité hors ligne</span><h2>Copie locale de cet appareil</h2>{offlineEntry?<><p>Dernière synchronisation locale : <strong>{formatDate(offlineEntry.data?.syncedAt||offlineEntry.savedAt)}</strong>.</p><div className="system-offline-counts"><span>{offlineEntry.data?.goodDeals??'—'} bons plans</span><span>{offlineEntry.data?.polls??'—'} sondages</span><span>{offlineEntry.data?.albums??'—'} albums</span></div><small>Accueil et Agenda utilisent également leur dernière copie locale pendant 12 heures. La déconnexion efface les copies privées de cet utilisateur.</small></>:<p>Aucune synchronisation hors ligne complète n’est encore enregistrée sur cet appareil.</p>}</section>
    </>}
  </div>
}

function Metric({value,label}){return <article><strong>{Number(value||0).toLocaleString('fr-FR')}</strong><span>{label}</span></article>}
