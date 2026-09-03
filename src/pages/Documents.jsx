import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { PageTitle } from './Actualites.jsx'

export default function Documents(){
 const [items,setItems]=useState([]); const [loading,setLoading]=useState(true); const [opening,setOpening]=useState('')
 useEffect(()=>{supabase.from('documents').select('*').order('created_at',{ascending:false}).then(({data})=>{setItems(data||[]);setLoading(false)})},[])
 const openDocument=async(doc)=>{setOpening(doc.id); const {data,error}=await supabase.storage.from('documents').createSignedUrl(doc.storage_path,60); setOpening(''); if(error){alert('Impossible d’ouvrir le document.');return} window.open(data.signedUrl,'_blank','noopener,noreferrer')}
 return <><PageTitle eyebrow="Ressources" title="Documents" text="Documents internes visibles uniquement par les membres autorisés pour chaque publication." /><div className="privacy-note">🔒 Les fichiers sont privés. Le serveur vérifie votre audience avant de générer un lien de consultation temporaire.</div>{loading?<div className="skeleton-card tall"/>:<div className="document-list">{items.length?items.map(x=><article className="document-row" key={x.id}><div className="file-icon">DOC</div><div><h3>{x.title}</h3><p>{x.description||'Document partagé'}</p><small>{new Date(x.created_at).toLocaleDateString('fr-FR')}</small></div><button className="secondary-button" onClick={()=>openDocument(x)} disabled={opening===x.id}>{opening===x.id?'Ouverture…':'Consulter'}</button></article>):<div className="empty-state">Aucun document partagé pour votre profil.</div>}</div>}</>
}
