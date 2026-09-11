import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { readOfflineEntry } from '../../lib/offlineCache.js'
import { PageTitle } from '../Actualites.jsx'
import '../../home-refactor.css'
import '../../offline-v2.css'

const PRIVATE_MEDIA_CACHE = 'danz-private-thumbs-v2'
const formatDate = (value) => value ? new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
const trimText = (value, max = 150) => { const text = String(value || '').trim(); return text.length > max ? `${text.slice(0, max).trim()}…` : text }

export default function OfflineDashboard() {
  const { user, profile } = useAuth()
  const entry = useMemo(() => readOfflineEntry(user?.id, 'dashboard-rich') || readOfflineEntry(user?.id, 'dashboard'), [user?.id])
  const albumsEntry = useMemo(() => readOfflineEntry(user?.id, 'albums'), [user?.id])
  const data = entry?.data || { news: [], events: [], bureau: [] }
  const [detail, setDetail] = useState(null)
  const [newsCoverMap, setNewsCoverMap] = useState({})

  const albumByEvent = useMemo(() => new Map((albumsEntry?.data || []).map((album) => [album.event_id, album])), [albumsEntry])
  const events = useMemo(() => (data.events || []).map((event) => {
    const localAlbum = albumByEvent.get(event.id)
    return {
      ...event,
      cover: event.cover || localAlbum?.offline_thumb || null,
      album: event.album || (localAlbum ? { id: localAlbum.id, event_id: localAlbum.event_id, item_count: localAlbum.item_count, transfer_expires_at: localAlbum.transfer_expires_at } : null),
    }
  }), [data.events, albumByEvent])
  const news = useMemo(() => (data.news || []).slice(0, 6).map((item) => ({ ...item, cover: item.cover || newsCoverMap[item.id] || null })), [data.news, newsCoverMap])

  useEffect(() => {
    if (!user?.id || !('caches' in window)) return undefined
    let cancelled = false
    const restoreCachedNewsCovers = async () => {
      try {
        const cache = await caches.open(PRIVATE_MEDIA_CACHE)
        const requests = await cache.keys()
        const restored = {}
        for (const item of data.news || []) {
          if (item.cover) continue
          const coverAsset = (item.assets || []).find((asset) => asset.is_cover)
          if (!coverAsset) continue
          const prefix = `/danz/offline-media/${encodeURIComponent(user.id)}/news/${encodeURIComponent(coverAsset.id)}-`
          const request = requests.find((candidate) => new URL(candidate.url).pathname.startsWith(prefix))
          if (request) restored[item.id] = new URL(request.url).pathname
        }
        if (!cancelled) setNewsCoverMap(restored)
      } catch {}
    }
    restoreCachedNewsCovers()
    return () => { cancelled = true }
  }, [user?.id, data.news])

  const now = Date.now()
  const future = useMemo(() => events.filter((event) => new Date(event.starts_at).getTime() >= now).slice(0, 4), [events, now])
  const recent = useMemo(() => events.filter((event) => new Date(event.starts_at).getTime() < now).sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at)).slice(0, 4), [events, now])

  return <div className="home-dashboard home-dashboard-compact">
    <PageTitle eyebrow="Mode hors ligne" title={profile?.full_name ? `Bonjour ${profile.full_name}` : 'Accueil'} text="Les dernières informations synchronisées restent consultables sans réseau." />
    <div className="offline-v2-notice"><strong>Consultation hors ligne</strong><span>{entry?.savedAt ? `Copie synchronisée le ${new Date(entry.savedAt).toLocaleString('fr-FR')}. ` : ''}Actualités, agenda, albums et bons plans restent accessibles depuis les raccourcis ci-dessous.</span></div>

    <nav className="home-app-actions" aria-label="Raccourcis hors ligne">
      <Link to="/agenda"><span>📅</span><strong>Agenda</strong></Link>
      <Link to="/sondages"><span>✓</span><strong>Sondages</strong></Link>
      <Link to="/bons-plans"><span>★</span><strong>Bons plans</strong></Link>
      <Link to="/galerie"><span>▦</span><strong>Albums</strong></Link>
    </nav>

    {!entry ? <div className="empty-state">Aucune copie de l’accueil n’est encore disponible. Reconnectez l’appareil une fois pour préparer automatiquement le mode hors ligne.</div> : <>
      <section className="home-live-section"><div className="home-section-title"><div><span className="eyebrow">Informations</span><h2>Actualités récentes</h2></div></div>{news.length ? <div className="home-editorial-grid compact-grid">{news.map((item) => <OfflineTile key={item.id} kind="news" item={item} onOpen={() => setDetail({ kind: 'news', item })} />)}</div> : <div className="empty-state">Aucune actualité enregistrée.</div>}</section>

      <section className="home-live-section"><div className="home-section-title"><div><span className="eyebrow">À venir</span><h2>Prochains rendez-vous</h2></div><Link className="home-more" to="/agenda">Agenda complet →</Link></div>{future.length ? <div className="home-editorial-grid compact-grid">{future.map((item) => <OfflineTile key={item.id} kind="event" item={item} onOpen={() => setDetail({ kind: 'event', item })} />)}</div> : <div className="empty-state">Aucun événement à venir dans la copie locale.</div>}</section>

      {recent.length > 0 && <section className="home-live-section"><div className="home-section-title"><div><span className="eyebrow">Souvenirs</span><h2>Événements récents</h2></div><Link className="home-more" to="/galerie">Albums →</Link></div><div className="home-editorial-grid compact-grid">{recent.map((item) => <OfflineTile key={item.id} kind="event" item={item} onOpen={() => setDetail({ kind: 'event', item })} />)}</div></section>}

      {(data.bureau || []).length > 0 && <section className="text-panel bureau-panel"><div className="bureau-heading"><div><span className="eyebrow">Organisation</span><h2>Membres du bureau</h2></div></div><div className="bureau-grid">{data.bureau.map((member) => <article className="bureau-card" key={member.role_key}><span className="bureau-role">{member.role_label}</span><strong>{member.full_name || 'À renseigner'}</strong></article>)}</div></section>}
    </>}

    {detail && <div className="home-detail-backdrop" role="presentation" onClick={() => setDetail(null)}><section className="home-detail-modal" role="dialog" aria-modal="true" aria-label={detail.item.title} onClick={(event) => event.stopPropagation()}><button type="button" className="home-detail-close" aria-label="Fermer" onClick={() => setDetail(null)}>×</button>{detail.item.cover && <img className="home-detail-cover" src={detail.item.cover} alt="" />}<div className="home-detail-content"><span className="eyebrow">{detail.kind === 'news' ? 'Actualité' : 'Événement'}</span><h2>{detail.item.title}</h2><time>{formatDate(detail.kind === 'news' ? (detail.item.publish_at || detail.item.published_at) : detail.item.starts_at)}</time>{detail.kind === 'event' && detail.item.location && <p>📍 {detail.item.location}</p>}<p className="home-detail-text">{detail.kind === 'news' ? (detail.item.content || detail.item.summary) : detail.item.description}</p>{detail.kind === 'event' && detail.item.album && <Link className="secondary-button" to={`/galerie?event=${detail.item.id}`} onClick={() => setDetail(null)}>📷 Ouvrir l’album hors ligne</Link>}<p className="login-help">Les pièces jointes et téléchargements complets nécessitent Internet.</p></div></section></div>}
  </div>
}

function OfflineTile({ kind, item, onOpen }) {
  const isEvent = kind === 'event'
  const date = isEvent ? item.starts_at : (item.publish_at || item.published_at)
  return <article className="home-editorial-card compact" role="button" tabIndex="0" onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen() } }}>
    <div className="home-tile-media">{item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <div className="home-tile-placeholder">{isEvent ? '📅' : '📣'}</div>}{isEvent && item.album && <span className="home-album-badge">📷 Album</span>}</div>
    <div className="home-tile-body"><time>{formatDate(date)}</time><h3>{item.title}</h3>{isEvent && item.location && <p className="home-tile-location">📍 {item.location}</p>}<p>{trimText(isEvent ? item.description : (item.summary || item.content)) || 'Ouvrez la tuile pour consulter les détails.'}</p><span className="home-tile-more">Voir les détails →</span></div>
  </article>
}
