import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { PageTitle } from './Actualites.jsx'

export default function Galerie(){
 const [items,setItems]=useState([])
 const [loading,setLoading]=useState(true)

 useEffect(()=>{
   let cancelled=false
   const load=async()=>{
     const {data}=await supabase.from('gallery').select('*').order('taken_at',{ascending:false,nullsFirst:false})
     const rows=data||[]
     const resolved=await Promise.all(rows.map(async(item)=>{
       if(!item.storage_path) return {...item,display_url:item.image_url}
       const {data:signed}=await supabase.storage.from('gallery').createSignedUrl(item.storage_path,3600)
       return {...item,display_url:signed?.signedUrl||null}
     }))
     if(!cancelled){setItems(resolved);setLoading(false)}
   }
   load()
   return()=>{cancelled=true}
 },[])

 return <><PageTitle eyebrow="Souvenirs" title="Galerie" text="Photos visibles uniquement par les membres autorisés pour chaque publication." />{loading?<div className="skeleton-card tall"/>:<div className="gallery-grid">{items.length?items.map(x=><figure className="gallery-item" key={x.id}>{x.display_url?<img src={x.display_url} alt={x.title||'Photo de l’amicale'} loading="lazy" />:<div className="empty-state">Photo indisponible</div>}<figcaption><strong>{x.title}</strong>{x.taken_at&&<span>{new Date(x.taken_at).toLocaleDateString('fr-FR',{month:'long',year:'numeric'})}</span>}</figcaption></figure>):<div className="empty-state">Aucune photo partagée pour votre profil.</div>}</div>}</>
}
