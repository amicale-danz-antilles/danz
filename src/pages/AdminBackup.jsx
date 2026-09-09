import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../admin-backup.css'

const dateStamp=()=>new Date().toISOString().slice(0,10)
const safeCell=value=>{
  if(value==null)return ''
  const raw=typeof value==='object'?JSON.stringify(value):String(value)
  return /^[=+\-@]/.test(raw)?`'${raw}`:raw
}
const toCsv=(rows,columns)=>{
  const escape=value=>`"${safeCell(value).replace(/"/g,'""')}"`
  return [columns.join(';'),...rows.map(row=>columns.map(column=>escape(row[column])).join(';'))].join('\r\n')
}
const download=(content,name,type)=>{
  const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a')
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)
}
const readLastBackup=()=>{try{return localStorage.getItem('danz-last-backup')||''}catch{return''}}
const saveLastBackup=value=>{try{localStorage.setItem('danz-last-backup',value)}catch{}}

export default function AdminBackup(){
 const {isAdmin,loading:authLoading}=useAuth()
 const [busy,setBusy]=useState('')
 const [error,setError]=useState('')
 const [success,setSuccess]=useState('')
 const [lastBackup,setLastBackup]=useState('')
 useEffect(()=>{setLastBackup(readLastBackup())},[])
 if(!authLoading&&!isAdmin)return <Navigate to="/" replace/>

 const snapshot=async()=>{
  const {data,error:fnError}=await supabase.functions.invoke('admin-data-export',{body:{action:'export'}})
  if(fnError||data?.error)throw new Error(data?.error||fnError?.message||'Export impossible.')

  // Les cotisations sont ajoutées à la sauvegarde dès que la table dédiée est disponible.
  // Une ancienne base sans cette table reste exportable sans erreur.
  const {data:dues,error:duesError}=await supabase.from('membership_dues').select('user_id,year,paid,paid_at,updated_by,updated_at').order('year',{ascending:false})
  if(!duesError){
    data.tables=data.tables||{}
    data.tables.membership_dues=dues||[]
  }
  return data
 }
 const run=async(kind)=>{
  if(busy)return
  setBusy(kind);setError('');setSuccess('')
  try{
   const data=await snapshot(),stamp=dateStamp()
   if(kind==='json'){
    download(JSON.stringify(data,null,2),`danz-sauvegarde-${stamp}.json`,'application/json;charset=utf-8')
    const when=new Date().toISOString();saveLastBackup(when);setLastBackup(when)
    setSuccess('Sauvegarde complète téléchargée. Conservez-la dans un emplacement protégé et maîtrisé.')
   }
   if(kind==='users'){
    const authById=Object.fromEntries((data.auth_users||[]).map(item=>[item.id,item]))
    const currentYear=new Date().getFullYear()
    const duesByUser=Object.fromEntries((data.tables?.membership_dues||[]).filter(item=>Number(item.year)===currentYear).map(item=>[item.user_id,item]))
    const rows=(data.tables?.profiles||[]).map(profile=>({
      ...profile,
      cotisation_annee:profile.is_amicaliste?currentYear:'',
      cotisation_reglee:profile.is_amicaliste?(duesByUser[profile.id]?.paid===true?'oui':'non'):'non_concerne',
      cotisation_reglee_le:duesByUser[profile.id]?.paid_at||'',
      last_sign_in_at:authById[profile.id]?.last_sign_in_at||'',
      email_confirmed_at:authById[profile.id]?.email_confirmed_at||'',
    }))
    download('\ufeff'+toCsv(rows,['id','full_name','email','role','active','access_type','applicant_type','military_reference','is_amicaliste','cotisation_annee','cotisation_reglee','cotisation_reglee_le','created_at','updated_at','deactivated_at','last_sign_in_at','email_confirmed_at']),`danz-utilisateurs-${stamp}.csv`,'text/csv;charset=utf-8')
    setSuccess('Export utilisateurs CSV téléchargé avec situation, statut amicaliste et cotisation annuelle.')
   }
   if(kind==='events'){
    download('\ufeff'+toCsv(data.tables?.events||[],['id','title','description','location','starts_at','ends_at','audience','publish_at','created_at']),`danz-evenements-${stamp}.csv`,'text/csv;charset=utf-8')
    setSuccess('Export événements CSV téléchargé.')
   }
   if(kind==='deals'){
    download('\ufeff'+toCsv(data.tables?.good_deals||[],['id','title','category','description','offer_text','address','municipality','phone','email','website_url','valid_until','audience','created_at','updated_at']),`danz-bons-plans-${stamp}.csv`,'text/csv;charset=utf-8')
    setSuccess('Export bons plans CSV téléchargé.')
   }
  }catch(err){setError(err.message||'Export impossible.')}finally{setBusy('')}
 }

 return <div className="admin-backup-page">
  <PageTitle eyebrow="Administration · Données" title="Sauvegardes & exports" text="Téléchargez une copie maîtrisée des données structurées du site et des exports lisibles pour vos contrôles administratifs."/>
  <div style={{marginBottom:'1rem'}}><Link className="ghost-button" to="/administration">← Administration</Link></div>
  {error&&<div className="alert error">{error}</div>}{success&&<div className="alert">{success}</div>}

  <section className="backup-primary-card">
   <div><span className="eyebrow">Sauvegarde de reprise</span><h2>Copie complète des données</h2><p>Inclut comptes et droits, situations déclarées, suivi des cotisations lorsqu’il est activé, demandes d’accès, actualités, événements, albums, bons plans, sondages, votes, bureau et journal d’administration. Les mots de passe, clés privées et fichiers photo/vidéo ne sont jamais inclus.</p>{lastBackup&&<small>Dernière sauvegarde téléchargée depuis cet appareil : {new Date(lastBackup).toLocaleString('fr-FR')}</small>}</div>
   <button className="primary-button backup-main-button" onClick={()=>run('json')} disabled={Boolean(busy)}>{busy==='json'?'Préparation…':'Télécharger la sauvegarde JSON'}</button>
  </section>

  <section><div className="admin-section-heading"><div><span className="eyebrow">Exports de contrôle</span><h2>Fichiers CSV</h2></div></div><div className="backup-export-grid">
   <article><span>👥</span><h3>Utilisateurs</h3><p>Identité, situation, statut amicaliste, cotisation annuelle, droits, état du compte et dernière connexion.</p><button className="secondary-button" onClick={()=>run('users')} disabled={Boolean(busy)}>{busy==='users'?'Export…':'Exporter en CSV'}</button></article>
   <article><span>📅</span><h3>Événements</h3><p>Dates, lieux, descriptions, audiences et dates de publication.</p><button className="secondary-button" onClick={()=>run('events')} disabled={Boolean(busy)}>{busy==='events'?'Export…':'Exporter en CSV'}</button></article>
   <article><span>★</span><h3>Bons plans</h3><p>Annuaire complet avec catégories, coordonnées et validité des offres.</p><button className="secondary-button" onClick={()=>run('deals')} disabled={Boolean(busy)}>{busy==='deals'?'Export…':'Exporter en CSV'}</button></article>
  </div></section>

  <div className="privacy-note backup-security-note"><strong>Règle de conservation :</strong> ces exports contiennent des données personnelles et, lorsqu’il est actif, le suivi des cotisations. Stockez-les uniquement sur un emplacement autorisé, protégé et accessible aux seules personnes habilitées. La sauvegarde JSON contient aussi les chemins des médias et les liens externes, mais pas les fichiers binaires eux-mêmes.</div>
 </div>
}
