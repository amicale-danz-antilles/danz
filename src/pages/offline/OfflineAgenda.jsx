import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { readOfflineEntry } from '../../lib/offlineCache.js'
import { PageTitle } from '../Actualites.jsx'
import '../../extra.css'
import '../../home-refactor.css'
import '../../offline-v2.css'

const escapeIcs = (value = '') => String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
const icsDate = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const isAlbumExpired = (album) => Boolean(album?.transfer_expires_at && new Date(album.transfer_expires_at).getTime() < Date.now())

export default function OfflineAgenda() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const entry = readOfflineEntry(user?.id, 'agenda-rich') || readOfflineEntry(user?.id, 'agenda')
  const data = entry?.data || { items: [], albums: {}, covers: {} }
  const items = data.items || []
  const albums = data.albums || {}
  const covers = data.covers || {}

  const addCalendar = (event) => {
    const start = new Date(event.starts_at)
    const end = event.ends_at ? new Date(event.ends_at) : new Date(start.getTime() + 3600000)
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Amicale DANZ Antilles//Agenda//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${event.id}@amicale-danz-antilles`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
      `SUMMARY:${escapeIcs(event.title)}`, event.description ? `DESCRIPTION:${escapeIcs(event.description)}` : null,
      event.location ? `LOCATION:${escapeIcs(event.location)}` : null, 'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n')
    const blob = new Blob([lines], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(event.title || 'evenement').replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').trim().replace(/\s+/g, '-') || 'evenement'}.ics`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  return <>
    <PageTitle eyebrow="Mode hors ligne" title="Agenda" text="Les rendez-vous synchronisés restent consultables sans réseau, avec leurs informations principales et certaines miniatures." />
    <div className="offline-v2-notice"><strong>Agenda disponible hors ligne</strong><span>{entry?.savedAt ? `Copie synchronisée le ${new Date(entry.savedAt).toLocaleString('fr-FR')}. ` : ''}Vous pouvez aussi générer un fichier calendrier local sans connexion.</span></div>
    {!entry ? <div className="empty-state">Aucune copie de l’agenda n’est encore disponible. Reconnectez l’appareil une fois pour la préparer automatiquement.</div> : <div className="timeline">{items.length ? items.map((event) => {
      const date = new Date(event.starts_at)
      const album = albums[event.id]
      const expired = isAlbumExpired(album)
      return <article className="timeline-item" key={event.id}><div className="timeline-date"><strong>{date.getDate()}</strong><span>{date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}</span></div><div className="timeline-card">
        {covers[event.id] && <img className="event-cover-image" src={covers[event.id]} alt="" loading="lazy" />}
        <div className="event-card-heading"><div><span className="event-time">{date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span><h2>{event.title}</h2></div></div>
        {event.location && <p><strong>Lieu :</strong> 📍 {event.location}</p>}
        {event.description && <p>{event.description}</p>}
        <div className="calendar-quick-add"><span>Ajouter au calendrier</span><button type="button" className="secondary-button" onClick={() => addCalendar(event)}>Télécharger .ics</button></div>
        {album && <div style={{ marginTop: '.75rem' }}><button type="button" className="secondary-button" onClick={() => navigate(`/galerie?event=${event.id}`)}>{expired ? '📷 Voir la miniature · lien expiré' : `📷 Ouvrir l’album hors ligne${album.item_count != null ? ` (${album.item_count})` : ''}`}</button></div>}
      </div></article>
    }) : <div className="empty-state">Aucun événement enregistré dans la copie locale.</div>}</div>}
  </>
}
