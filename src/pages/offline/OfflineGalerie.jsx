import { useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { readOfflineEntry } from '../../lib/offlineCache.js'
import { PageTitle } from '../Actualites.jsx'
import '../../gallery-events.css'
import '../../offline-v2.css'

const formatDate=value=>value?new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}):''

export default function OfflineGalerie(){
  const {user}=useAuth()
  const entry=readOfflineEntry(user?.id,'albums')
  const albums=entry?.data||[]
  const [selectedId,setSelectedId]=useState('')
  const selected=useMemo(()=>albums.find(album=>album.id===selectedId)||null,[albums,selectedId])

  return <>
    <PageTitle eyebrow="Mode hors ligne" title="Albums" text="Les miniatures légères déjà synchronisées restent disponibles. Le téléchargement complet des photos et vidéos nécessite Internet."/>
    <div className="offline-v2-notice"><strong>Index hors ligne</strong><span>{entry?.savedAt?`Copie synchronisée le ${new Date(entry.savedAt).toLocaleString('fr-FR')}. `:''}Les liens WeTransfer ne sont jamais conservés localement.</span></div>
    {!entry?<div className="empty-state">Aucun album n’a encore été synchronisé sur cet appareil. Ouvrez la Galerie une fois avec Internet pour préparer le mode hors ligne.</div>:selected?<AlbumDetail album={selected} onBack={()=>setSelectedId('')}/>:<div className="gallery-album-grid offline-album-grid">{albums.length?albums.map(album=>{const expired=Boolean(album.transfer_expires_at&&new Date(album.transfer_expires_at).getTime()<Date.now());return <button className="gallery-album-card" type="button" key={album.id} onClick={()=>setSelectedId(album.id)}><div className="gallery-album-cover">{album.offline_thumb?<img src={album.offline_thumb} alt=""/>:<span>📷</span>}{expired&&<span className="album-expired-badge">Lien expiré</span>}</div><div className="gallery-album-info"><strong>{album.event?.title||'Album'}</strong><span>{formatDate(album.event?.starts_at)}</span><small>{expired?'Lien expiré':'Ouvrir la fiche →'}</small></div></button>}):<div className="empty-state">Aucun album enregistré.</div>}</div>}
  </>
}

function AlbumDetail({album,onBack}){
  const expired=Boolean(album.transfer_expires_at&&new Date(album.transfer_expires_at).getTime()<Date.now())
  if(expired)return <section className="offline-album-detail"><button type="button" className="secondary-button" onClick={onBack}>← Tous les albums</button>{album.offline_thumb&&<img className="offline-album-hero" src={album.offline_thumb} alt=""/>}<span className="eyebrow">Album expiré</span><h2>{album.event?.title||'Album'}</h2><div className="offline-download-state expired">Lien expiré. Le contenu complet n’est plus accessible ; seule la miniature reste conservée.</div></section>

  return <section className="offline-album-detail"><button type="button" className="secondary-button" onClick={onBack}>← Tous les albums</button>{album.offline_thumb&&<img className="offline-album-hero" src={album.offline_thumb} alt=""/>}<span className="eyebrow">Souvenir</span><h2>{album.event?.title||'Album'}</h2><p className="offline-album-meta">📅 {formatDate(album.event?.starts_at)}{album.event?.location?` · 📍 ${album.event.location}`:''}</p>{album.event?.description&&<p>{album.event.description}</p>}{album.item_count!=null&&<div className="home-album-summary"><span>📷</span><div><strong>{album.item_count} média{album.item_count>1?'s':''}</strong><small>Album complet disponible en ligne</small></div></div>}{album.download_note&&<div className="privacy-note">{album.download_note}</div>}<div className="offline-download-state">Reconnectez-vous pour ouvrir le téléchargement complet.</div></section>
}
