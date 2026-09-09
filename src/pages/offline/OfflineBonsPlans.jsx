import { useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { readOfflineEntry } from '../../lib/offlineCache.js'
import { PageTitle } from '../Actualites.jsx'
import '../../offline-v2.css'

const CATEGORIES={
  restaurant:['Restaurants & gourmandises','🍴'],loisirs:['Sorties & loisirs','🎟️'],nature:['Nature & plages','🌴'],famille:['Famille','👨‍👩‍👧‍👦'],shopping:['Shopping & commerces','🛍️'],bien_etre:['Bien-être & sport','🌿'],services:['Services & pratique','🧰'],hebergement:['Hébergements & escapades','🏡'],autre:['Autres bons plans','✨'],
}
const isExpired=deal=>Boolean(deal.valid_until&&new Date(`${deal.valid_until}T23:59:59`).getTime()<Date.now())

export default function OfflineBonsPlans(){
  const {user}=useAuth()
  const entry=readOfflineEntry(user?.id,'good-deals')
  const items=entry?.data||[]
  const [search,setSearch]=useState('')
  const [category,setCategory]=useState('all')
  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase()
    return items.filter(item=>!isExpired(item)).filter(item=>{
      if(category!=='all'&&item.category!==category)return false
      if(!q)return true
      return [item.title,item.description,item.offer_text,item.address,item.municipality,CATEGORIES[item.category]?.[0]].filter(Boolean).join(' ').toLowerCase().includes(q)
    }).sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''),'fr'))
  },[items,search,category])

  return <>
    <PageTitle eyebrow="Mode hors ligne" title="Bons plans" text="Les fiches synchronisées restent consultables sans réseau. La carte, les sites externes et les propositions nécessitent une connexion Internet."/>
    <div className="offline-v2-notice"><strong>Lecture seule</strong><span>{entry?.savedAt?`Copie synchronisée le ${new Date(entry.savedAt).toLocaleString('fr-FR')}. `:''}Les horaires, tarifs ou coordonnées peuvent avoir changé depuis.</span></div>
    {!entry?<div className="empty-state">Aucune copie des bons plans n’a encore été enregistrée sur cet appareil. Ouvrez le site une fois avec Internet pour préparer le mode hors ligne.</div>:<>
      <div className="offline-deals-toolbar">
        <label>Rechercher<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nom, commune, avantage…"/></label>
        <label>Catégorie<select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">Toutes les catégories</option>{Object.entries(CATEGORIES).map(([value,[label,icon]])=><option value={value} key={value}>{icon} {label}</option>)}</select></label>
      </div>
      <div className="offline-deals-count">{filtered.length} bon{filtered.length>1?'s':''} plan{filtered.length>1?'s':''} disponible{filtered.length>1?'s':''}</div>
      <div className="offline-deals-grid">{filtered.map(deal=><DealCard key={deal.id} deal={deal}/>)}</div>
      {filtered.length===0&&<div className="empty-state">Aucun bon plan ne correspond à cette recherche.</div>}
    </>}
  </>
}

function DealCard({deal}){
  const [label,icon]=CATEGORIES[deal.category]||CATEGORIES.autre
  return <article className="offline-deal-card"><span className="offline-deal-category">{icon} {label}</span><h3>{deal.title}</h3>{deal.offer_text&&<div className="offline-deal-offer">★ {deal.offer_text}</div>}{deal.description&&<p>{deal.description}</p>}{(deal.address||deal.municipality)&&<p className="offline-deal-location">📍 {[deal.address,deal.municipality].filter(Boolean).join(', ')}</p>}<div className="offline-deal-contacts">{deal.phone&&<a href={`tel:${String(deal.phone).replace(/\s/g,'')}`}>☎ {deal.phone}</a>}{deal.email&&<a href={`mailto:${deal.email}`}>✉ {deal.email}</a>}</div>{deal.valid_until&&<small>Valable jusqu’au {new Date(`${deal.valid_until}T12:00:00`).toLocaleDateString('fr-FR')}</small>}</article>
}
