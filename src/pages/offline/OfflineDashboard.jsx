import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { readOfflineEntry } from '../../lib/offlineCache.js'
import { PageTitle } from '../Actualites.jsx'
import HomeOpenPolls from '../../components/HomeOpenPolls.jsx'
import '../../home-refactor.css'
import '../../offline-v2.css'

const PRIVATE_MEDIA_CACHE = 'danz-private-thumbs-v2'
const formatDate = (value) => value ? new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
const trimText = (value, max = 150) => { const text = String(value || '').trim(); return text.length > max ? `${text.slice(0, max).trim()}…` : text }
const publicationTime = (item) => new Date(item?._kind === 'event' ? (item.starts_at || item.created_at || item.publish_at) : (item.publish_at || item.published_at || item.created_at)).getTime() || 0
const eventSchedule = (event) => {
  const start = new Date(event.starts_at)
  if (!event.ends_at) return `${formatDate(start)} · ${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
  const end = new Date(event.ends_at)
  if (start.toDateString() === end.toDateString()) return `${formatDate(start)} · ${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} → ${end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
  return `${formatDate(start)} → ${formatDate(end)}`
}

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
  const news = useMemo(() => (data.news || []).map((item) => ({ ...item, cover: item.cover || newsCoverMap[item.id] || null })), [data.news, newsCoverMap])

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

  const publications = useMemo(() => [
    ...news.map((item) => ({ ...item, _kind: 'news' })),
    ...events.map((item) => ({ ...item, _kind: 'event' })),
  ].sort((a, b) => publicationTime(b) - publicationTime(a)).slice(0, 10), [news, events])

  return <div className="home-dashboard home-dashboard-compact">
    <PageTitle eyebrow="Mode hors ligne" title={profile?.full_name ? `Bonjour ${profile.full_name}` : 'Accueil'} text="Les dernières publications synchronisées restent consultables sans réseau." />
    <div className="offline-v2-notice"><strong>Consultation hors ligne</strong><span>{entry?.savedAt ? `Copie synchronisée le ${new Date(entry.savedAt).toLocaleString('fr-FR')}. ` : ''}Publications, agenda, albums, bons plans et sondages ouverts restent accessibles directement depuis l’accueil.</span></div>

    <nav className="home-app-actions" aria-label="Raccourcis hors ligne">
      <Link to="/agenda"><span>📅</span><strong>Agenda</strong></Link>
      <Link to="/bons-plans"><span>★</span><strong>Bons plans</strong></Link>
      <Link to="/galerie"><span>▦</span><strong>Albums</strong></Link>
    </nav>

    <HomeOpenPolls />

    {!entry ? <div className="empty-state">Aucune copie de l’accueil n’est encore disponible. Reconnectez l’appareil une fois pour préparer automatiquement le mode hors ligne.</div> : <>
      <section className="home-live-section"><div className="home-section-title"><div><span className="eyebrow">À la une</span><h2>Publications récentes</h2></div><Link className="home-more" to="/agenda">Agenda →</Link></div>{publications.length ? <div className="home-editorial-grid compact-grid">{publications.map((item) => <OfflineTile key={`${item._kind}-${item.id}`} item={item} onOpen={() => setDetail({ kind: item._kind, item })} />)}</div> : <div className="empty-state">Aucune publication enregistrée.</div>}</section>

      {(data.bureau || []).length > 0 && <section className="text-panel bureau-panel"><div className="bureau-heading"><div><span className="eyebrow">Organisation</span><h2>Membres du bureau</h2></div></div><div className="bureau-grid">{data.bureau.map((member) => <article className="bureau-card" key={member.role_key}><span className="bureau-role">{member.role_label}</span><strong>{member.full_name || 'À renseigner'}</strong></article>)}</div></section>}
    </>}

    {detail && <div className="home-detail-backdrop" role="presentation" onClick={() => setDetail(null)}><section className="home-detail-modal" role="dialog" aria-modal="true" aria-label={detail.item.title} onClick={(event) => event.stopPropagation()}><button type="button" className="home-detail-close" aria-label="Fermer" onClick={() => setDetail(null)}>×</button>{detail.item.cover && <img className="home-detail-cover" src={detail.item.cover} alt="" />}<div className="home-detail-content"><span className="eyebrow">{detail.kind === 'news' ? 'Information' : 'Événement'}</span><h2>{detail.item.title}</h2><time>{detail.kind === 'news' ? formatDate(detail.item.publish_at || detail.item.published_at) : eventSchedule(detail.item)}</time>{detail.kind === 'event' && detail.item.location && <p>📍 {detail.item.location}</p>}<p className="home-detail-text">{detail.kind === 'news' ? (detail.item.content || detail.item.summary) : detail.item.description}</p>{detail.kind === 'event' && detail.item.album && <Link className="secondary-button" to={`/galerie?event=${detail.item.id}`} onClick={() => setDetail(null)}>📷 Ouvrir l’album hors ligne</Link>}<p className="login-help">Les pièces jointes et téléchargements complets nécessitent Internet.</p></div></section></div>}
  </div>
}

function OfflineTile({ item, onOpen }) {
  const isEvent = item._kind === 'event'
  return <article className="home-editorial-card compact" role="button" tabIndex="0" onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen() } }}>
    <div className="home-tile-media">{item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <div className="home-tile-placeholder">{isEvent ? '📅' : '📣'}</div>}{isEvent && item.album && <span className="home-album-badge">📷 Album</span>}</div>
    <div className="home-tile-body"><span className="role-badge">{isEvent ? 'Événement' : 'Information'}</span><time>{isEvent ? eventSchedule(item) : formatDate(item.publish_at || item.published_at)}</time><h3>{item.title}</h3>{isEvent && item.location && <p className="home-tile-location">📍 {item.location}</p>}<p>{trimText(isEvent ? item.description : (item.summary || item.content)) || 'Ouvrez la tuile pour consulter les détails.'}</p><span className="home-tile-more">Voir les détails →</span></div>
  </article>
}
