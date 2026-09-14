import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getR2Status, optimizeImageFile, removePrivateMedia, uploadPrivateMedia } from '../lib/mediaStorage.js'
import { PageTitle } from './Actualites.jsx'
import Galerie from './Galerie.jsx'
import '../admin-content-unified.css'

const audienceLabels = { everyone: 'Tout le monde', military: 'Militaires DANZ uniquement', amicaliste: 'Amicalistes uniquement', admin: 'Bureau / Admin uniquement' }
const toLocalInput = (value) => { if (!value) return ''; const d = new Date(value); const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16) }
const PHOTO_LIMIT = 30 * 1024 * 1024
const FILE_LIMIT = 200 * 1024 * 1024

const stateForItem = (item) => {
  if (item?.published === false) return 'draft'
  if (item?.publish_at && new Date(item.publish_at).getTime() > Date.now()) return 'scheduled'
  return 'published'
}
const stateLabel = (state) => state === 'draft' ? 'Brouillon' : state === 'scheduled' ? 'Programmé' : 'Publié'
const itemKindLabel = (item) => item?._kind === 'event' ? 'Événement' : 'Information'
const itemSortTime = (item) => new Date(item?._kind === 'event' ? (item.starts_at || item.publish_at || item.created_at) : (item.publish_at || item.published_at || item.created_at)).getTime() || 0
const formatPeriod = (item) => {
  if (item?._kind !== 'event' || !item.starts_at) return `Publication : ${new Date(item.publish_at || item.created_at).toLocaleString('fr-FR')}`
  const start = new Date(item.starts_at)
  if (!item.ends_at) return `Événement le ${start.toLocaleString('fr-FR')}`
  const end = new Date(item.ends_at)
  if (start.toDateString() === end.toDateString()) return `Événement le ${start.toLocaleDateString('fr-FR')} · ${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} → ${end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
  return `Événement du ${start.toLocaleString('fr-FR')} au ${end.toLocaleString('fr-FR')}`
}

export default function AdminContent() {
  const { user, isAdmin, loading: authLoading } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedType = searchParams.get('type')
  const initialType = requestedType === 'albums' ? 'albums' : 'publications'
  const [type, setType] = useState(initialType)
  const [contentKind, setContentKind] = useState(requestedType === 'events' ? 'event' : 'news')
  const [editing, setEditing] = useState(null)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [location, setLocation] = useState('')
  const [eventDateMode, setEventDateMode] = useState('single')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [cover, setCover] = useState(null)
  const [files, setFiles] = useState([])
  const [audience, setAudience] = useState('everyone')
  const [publicationMode, setPublicationMode] = useState('published')
  const [publishAt, setPublishAt] = useState('')
  const [notifyOnPublish, setNotifyOnPublish] = useState(true)
  const [recent, setRecent] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [r2Ready, setR2Ready] = useState(false)
  const [notificationSettings, setNotificationSettings] = useState({ enabled: true, news: true, events: true })

  useEffect(() => {
    const next = searchParams.get('type')
    const normalized = next === 'albums' ? 'albums' : 'publications'
    if (normalized !== type) { setType(normalized); reset(false) }
    if (!editing && next === 'events') setContentKind('event')
    if (!editing && next === 'news') setContentKind('news')
  }, [searchParams])

  const loadRecent = async () => {
    if (!isAdmin || type === 'albums') return
    const [newsResult, eventsResult] = await Promise.all([
      supabase.from('news').select('*').order('publish_at', { ascending: false }).limit(50),
      supabase.from('events').select('*').order('starts_at', { ascending: false }).limit(50),
    ])
    if (newsResult.error || eventsResult.error) setError('Impossible de charger complètement la liste des publications enregistrées.')
    const merged = [
      ...(newsResult.data || []).map((item) => ({ ...item, _kind: 'news' })),
      ...(eventsResult.data || []).map((item) => ({ ...item, _kind: 'event' })),
    ].sort((a, b) => itemSortTime(b) - itemSortTime(a))
    setRecent(merged)
  }

  const loadNotificationSettings = async () => {
    if (!isAdmin) return
    const { data } = await supabase.from('notification_settings').select('enabled,news,events').eq('id', 1).single()
    if (data) setNotificationSettings(data)
  }

  useEffect(() => { loadRecent() }, [type, isAdmin])
  useEffect(() => { if (isAdmin) { getR2Status().then(setR2Ready); loadNotificationSettings() } }, [isAdmin])
  if (!authLoading && !isAdmin) return <Navigate to="/" replace />

  const reset = (clearMessages = true) => {
    setEditing(null); setTitle(''); setText(''); setLocation(''); setEventDateMode('single'); setStartsAt(''); setEndsAt(''); setCover(null); setFiles([]); setAudience('everyone'); setPublicationMode('published'); setPublishAt(''); setNotifyOnPublish(true)
    if (clearMessages) { setError(''); setSuccess('') }
    const a = document.getElementById('content-cover'); if (a) a.value = ''
    const b = document.getElementById('content-files'); if (b) b.value = ''
  }

  const switchType = (next) => {
    if (next === type) return
    reset(); setRecent([]); setType(next); setSearchParams({ type: next })
  }

  const beginEdit = (item) => {
    const kind = item._kind === 'event' ? 'event' : 'news'
    setEditing(item); setContentKind(kind); setTitle(item.title || '')
    setText(kind === 'news' ? (item.content || '') : (item.description || ''))
    setLocation(kind === 'event' ? (item.location || '') : '')
    setEventDateMode(kind === 'event' && item.ends_at ? 'range' : 'single')
    setStartsAt(kind === 'event' ? toLocalInput(item.starts_at) : '')
    setEndsAt(kind === 'event' ? toLocalInput(item.ends_at) : '')
    setAudience(item.audience || 'everyone'); setPublicationMode(stateForItem(item)); setPublishAt(stateForItem(item) === 'scheduled' ? toLocalInput(item.publish_at) : '')
    setNotifyOnPublish(item.notify_on_publish !== false); setCover(null); setFiles([]); setError(''); setSuccess(''); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const validatePhoto = (file) => { if (!file) return; if (!file.type.startsWith('image/')) throw new Error('La photo principale doit être une image.'); if (file.size > PHOTO_LIMIT) throw new Error('La photo principale dépasse 30 Mo avant optimisation.') }
  const validateFiles = (list) => list.forEach((file) => { if (file.size > FILE_LIMIT) throw new Error(`${file.name} dépasse 200 Mo.`) })

  const addAttachment = async (file, parentKind, parentId, isCover = false) => {
    const stored = await uploadPrivateMedia(file, { scope: 'content', parentId, fallbackBucket: 'content' })
    const isNews = parentKind === 'news'
    const parentColumn = isNews ? 'news_id' : 'event_id'
    const payload = { news_id: isNews ? parentId : null, event_id: isNews ? null : parentId, file_name: file.name || 'fichier', storage_provider: stored.storage_provider, storage_path: stored.storage_path, mime_type: file.type || null, file_size: file.size, is_cover: isCover, created_by: user.id }
    const { data, error: insertError } = await supabase.from('content_attachments').insert(payload).select('*').single()
    if (insertError) { await removePrivateMedia({ ...stored }, { fallbackBucket: 'content' }).catch(() => {}); throw insertError }
    if (isCover) {
      const { error: demoteError } = await supabase.from('content_attachments').update({ is_cover: false }).eq(parentColumn, parentId).eq('is_cover', true).neq('id', data.id)
      if (demoteError) { await supabase.from('content_attachments').delete().eq('id', data.id); await removePrivateMedia({ ...data, ...stored }, { entity: 'attachment', fallbackBucket: 'content' }).catch(() => {}); throw demoteError }
    }
    return data
  }

  const publicationValues = () => {
    if (publicationMode === 'draft') return { published: false, publish_at: editing?.publish_at || new Date().toISOString() }
    if (publicationMode === 'scheduled') {
      if (!publishAt) throw new Error('Choisissez la date et l’heure de publication.')
      const d = new Date(publishAt)
      if (Number.isNaN(d.getTime()) || d <= new Date()) throw new Error('Choisissez une date de publication future.')
      return { published: true, publish_at: d.toISOString() }
    }
    const editingAlreadyPublished = editing && editing.published !== false && editing.publish_at && new Date(editing.publish_at).getTime() <= Date.now()
    return { published: true, publish_at: editingAlreadyPublished ? editing.publish_at : new Date().toISOString() }
  }

  const submit = async (event) => {
    event.preventDefault(); if (busy) return
    setBusy(true); setError(''); setSuccess('')
    const kind = editing?._kind || contentKind
    const table = kind === 'event' ? 'events' : 'news'
    let parentId = editing?.id || null
    let createdParent = false
    const createdAssets = []
    try {
      if (!title.trim()) throw new Error('Ajoutez un titre.')
      validatePhoto(cover); validateFiles(files)
      const publication = publicationValues()
      const originalState = editing ? stateForItem(editing) : null
      const scheduleChanged = Boolean(editing && publicationMode === 'scheduled' && publication.publish_at !== editing.publish_at)
      const firstPublication = Boolean(editing && originalState === 'draft' && publication.published)
      const resetNotification = firstPublication || scheduleChanged

      if (kind === 'news') {
        const payload = { title: title.trim(), summary: text.trim().slice(0, 260) || null, content: text.trim() || null, audience, published: publication.published, publish_at: publication.publish_at, notify_on_publish: notifyOnPublish }
        if (!editing) payload.published_at = publication.published ? publication.publish_at : new Date().toISOString()
        else if (firstPublication) payload.published_at = publication.publish_at
        if (resetNotification) payload.notified_at = null
        const result = editing ? await supabase.from('news').update(payload).eq('id', editing.id).select('id').single() : await supabase.from('news').insert({ ...payload, created_by: user.id }).select('id').single()
        if (result.error) throw result.error; parentId = result.data.id; createdParent = !editing
      } else {
        if (!startsAt) throw new Error('Indiquez la date et l’heure de l’événement.')
        const start = new Date(startsAt)
        const end = eventDateMode === 'range' ? new Date(endsAt) : null
        if (Number.isNaN(start.getTime())) throw new Error('Date de début invalide.')
        if (eventDateMode === 'range' && (!endsAt || Number.isNaN(end.getTime()))) throw new Error('Indiquez la date et l’heure de fin de la plage.')
        if (end && end <= start) throw new Error('La fin de la plage doit être après le début.')
        const payload = { title: title.trim(), description: text.trim() || null, location: location.trim() || null, starts_at: start.toISOString(), ends_at: end ? end.toISOString() : null, audience, published: publication.published, publish_at: publication.publish_at, notify_on_publish: notifyOnPublish }
        if (resetNotification) payload.notified_at = null
        const result = editing ? await supabase.from('events').update(payload).eq('id', editing.id).select('id').single() : await supabase.from('events').insert({ ...payload, created_by: user.id }).select('id').single()
        if (result.error) throw result.error; parentId = result.data.id; createdParent = !editing
      }

      if (cover) { const optimizedCover = await optimizeImageFile(cover); createdAssets.push(await addAttachment(optimizedCover, kind, parentId, true)) }
      if (kind === 'news' && files.length) for (const file of files) createdAssets.push(await addAttachment(file, 'news', parentId, false))
      setSuccess(`${kind === 'news' ? 'Information' : 'Événement'} ${editing ? 'modifié' : 'enregistré'} · ${stateLabel(publicationMode).toLowerCase()}${notifyOnPublish ? ' · notification activée' : ' · sans notification'}.`)
      reset(false); await loadRecent()
    } catch (err) {
      if (createdParent && parentId) { for (const asset of createdAssets) await removePrivateMedia(asset, { entity: 'attachment', fallbackBucket: 'content' }).catch(() => {}); await supabase.from(table).delete().eq('id', parentId) }
      const suffix = editing && createdAssets.length ? ' Les modifications du texte ont pu être enregistrées avant l’échec d’un fichier ; vérifiez la publication avant de recommencer.' : ''
      setError(`${err.message || 'Impossible d’enregistrer cette publication.'}${suffix}`)
    } finally { setBusy(false) }
  }

  const removeItem = async (item) => {
    if (busy || !window.confirm(`Supprimer définitivement « ${item.title} » ? Cette action retire aussi ses fichiers et son album lié le cas échéant.`)) return
    setBusy(true); setError(''); setSuccess('')
    const kind = item._kind === 'event' ? 'event' : 'news'
    const table = kind === 'event' ? 'events' : 'news'
    try {
      const parentColumn = kind === 'news' ? 'news_id' : 'event_id'
      const { data: attachments, error: attachmentsError } = await supabase.from('content_attachments').select('*').eq(parentColumn, item.id)
      if (attachmentsError) throw attachmentsError
      let albumRows = []
      if (kind === 'event') {
        const { data, error: albumError } = await supabase.from('event_albums').select('*').eq('event_id', item.id)
        if (albumError) throw albumError
        albumRows = data || []
      }
      const { error: deleteError } = await supabase.from(table).delete().eq('id', item.id)
      if (deleteError) throw deleteError
      let cleanupWarning = false
      for (const asset of attachments || []) { try { await removePrivateMedia(asset, { entity: 'attachment', fallbackBucket: 'content' }) } catch (_) { cleanupWarning = true } }
      for (const album of albumRows) { if (album.storage_path && album.source_gallery_id == null) { try { await removePrivateMedia(album, { entity: 'album', fallbackBucket: 'gallery' }) } catch (_) { cleanupWarning = true } } }
      if (editing?.id === item.id) reset(false)
      setSuccess(cleanupWarning ? 'Publication supprimée. Un ancien fichier n’a pas pu être nettoyé automatiquement du stockage.' : 'Publication et fichiers associés supprimés.')
      await loadRecent()
    } catch (err) { setError(err.message || 'Suppression impossible.') }
    finally { setBusy(false) }
  }

  const updatePublication = async (item, payload, successText) => {
    const table = item._kind === 'event' ? 'events' : 'news'
    setBusy(true); setError(''); setSuccess('')
    const { error: updateError } = await supabase.from(table).update(payload).eq('id', item.id)
    if (updateError) setError(updateError.message || 'Modification impossible.')
    else { setSuccess(successText); await loadRecent() }
    setBusy(false)
  }

  const setPublishedNow = (item) => updatePublication(item, { published: true, publish_at: new Date().toISOString(), ...(item.notify_on_publish !== false ? { notified_at: null } : {}) }, 'Publication mise en ligne. La notification sera traitée automatiquement si elle est activée.')
  const unpublishItem = async (item) => { if (!window.confirm(`Dépublier « ${item.title} » ? Le contenu restera enregistré dans l’administration.`)) return; await updatePublication(item, { published: false }, 'Publication repassée en brouillon.'); if (editing?.id === item.id) setPublicationMode('draft') }
  const resendNotification = async (item) => { if (!window.confirm(`Renvoyer une notification pour « ${item.title} » ?`)) return; await updatePublication(item, { notify_on_publish: true, notified_at: null }, 'Notification remise en file d’attente. Elle sera traitée automatiquement dans la minute.') }

  const globalNotificationEnabled = notificationSettings.enabled && (contentKind === 'event' ? notificationSettings.events : notificationSettings.news)
  const publicationsCount = useMemo(() => recent.length, [recent])

  return <div className="admin-content-shell">
    <PageTitle eyebrow="Administration" title="Publications" text="Informations et événements sont réunis dans une seule rubrique. Créez, modifiez, programmez, dépubliez ou supprimez depuis la même liste." />
    <div className="admin-content-tabs" role="tablist" aria-label="Type de contenu">
      <button type="button" className={`admin-content-tab ${type === 'publications' ? 'active' : ''}`} onClick={() => switchType('publications')}>📰 Publications</button>
      <button type="button" className={`admin-content-tab ${type === 'albums' ? 'active' : ''}`} onClick={() => switchType('albums')}>🖼️ Albums</button>
    </div>

    <section className="privacy-note"><strong>Notifications :</strong> informations et événements utilisent désormais la même préférence “Publications”. Les réglages globaux, sondages, albums et demandes d’accès sont disponibles dans <Link to="/notifications">Notifications</Link>.</section>

    {type === 'albums' ? <Galerie forceAdminMode embeddedAdmin /> : <>
      <div className="text-panel"><form onSubmit={submit}>
        {editing && <div className="alert"><strong>Modification :</strong> {editing.title}</div>}
        <label>Type de publication<select value={contentKind} disabled={busy || Boolean(editing)} onChange={(event) => setContentKind(event.target.value)}><option value="news">Information</option><option value="event">Événement</option></select><small>{editing ? 'Le type est conservé pendant une modification.' : 'Une information n’a pas de date d’événement ; un événement peut avoir une date précise ou une plage.'}</small></label>
        <label>Titre<input required maxLength="160" disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>{contentKind === 'news' ? 'Contenu' : 'Description'}<textarea rows="6" maxLength="10000" disabled={busy} value={text} onChange={(event) => setText(event.target.value)} placeholder={contentKind === 'news' ? 'Écrivez directement l’information à publier…' : 'Présentez le rendez-vous…'} /></label>

        {contentKind === 'event' && <>
          <label>Lieu<input maxLength="180" disabled={busy} value={location} onChange={(event) => setLocation(event.target.value)} /></label>
          <label>Dates de l’événement<select value={eventDateMode} disabled={busy} onChange={(event) => { setEventDateMode(event.target.value); if (event.target.value === 'single') setEndsAt('') }}><option value="single">Date précise</option><option value="range">Plage de dates</option></select></label>
          {eventDateMode === 'single' ? <label>Date et heure<input type="datetime-local" required disabled={busy} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label> : <div className="admin-publication-options"><label>Début de la plage<input type="datetime-local" required disabled={busy} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label>Fin de la plage<input type="datetime-local" required disabled={busy} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div>}
        </>}

        <label>Photo principale (facultatif)<input id="content-cover" type="file" accept="image/*" disabled={busy} onChange={(event) => setCover(event.target.files?.[0] || null)} /><small>Une nouvelle photo remplace automatiquement la photo principale actuelle.</small></label>
        {contentKind === 'news' && <label>Fichiers joints à ajouter (facultatif)<input id="content-files" type="file" multiple disabled={busy} onChange={(event) => setFiles([...event.target.files])} /><small>PDF, Word, Excel, images ou autres fichiers utiles.</small></label>}

        <div className="admin-publication-options"><label>Audience<select disabled={busy} value={audience} onChange={(event) => setAudience(event.target.value)}>{Object.entries(audienceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>État<select disabled={busy} value={publicationMode} onChange={(event) => setPublicationMode(event.target.value)}><option value="draft">Brouillon · invisible</option><option value="published">Publié</option><option value="scheduled">Programmé</option></select></label></div>
        {publicationMode === 'scheduled' && <label>Date et heure de publication<input type="datetime-local" required disabled={busy} value={publishAt} onChange={(event) => setPublishAt(event.target.value)} /></label>}
        <label className="admin-notification-toggle"><span><strong>Notifier les utilisateurs à la publication</strong><small>{globalNotificationEnabled ? 'La notification partira selon la préférence “Publications” de chaque compte.' : 'Les notifications de cette catégorie sont actuellement désactivées globalement.'}</small></span><input type="checkbox" checked={notifyOnPublish} disabled={busy} onChange={(event) => setNotifyOnPublish(event.target.checked)} /></label>
        <div className="privacy-note">☁️ {r2Ready ? 'Cloudflare R2 est connecté pour les nouveaux fichiers.' : 'Supabase sert de stockage de secours tant que R2 n’est pas disponible.'}</div>
        {error && <div className="alert error">{error}</div>}{success && <div className="alert">{success}</div>}
        <div style={{ display: 'flex', gap: '.65rem', flexWrap: 'wrap' }}><button className="primary-button" disabled={busy}>{busy ? 'Enregistrement…' : editing ? 'Enregistrer les modifications' : 'Enregistrer la publication'}</button>{editing && <button type="button" className="ghost-button" disabled={busy} onClick={() => reset()}>Annuler</button>}</div>
      </form></div>

      <section className="text-panel"><div className="admin-notification-heading"><div><span className="eyebrow">Gestion</span><h2>Publications enregistrées</h2></div><small className="admin-inline-note">{publicationsCount} publication{publicationsCount > 1 ? 's' : ''} · plus récentes en premier</small></div>
        {recent.length === 0 ? <div className="admin-content-empty">Aucune publication.</div> : <div className="admin-content-list">{recent.map((item) => {
          const state = stateForItem(item)
          const due = state === 'published'
          return <article className="admin-content-row" key={`${item._kind}-${item.id}`}><div><div className="admin-content-meta"><span className="role-badge">{itemKindLabel(item)}</span><span className={`publication-state ${state}`}>{stateLabel(state)}</span><span className="role-badge">{audienceLabels[item.audience] || 'Tout le monde'}</span><span className={`publication-state ${item.notify_on_publish === false ? 'no-notify' : item.notified_at ? 'notified' : ''}`}>{item.notify_on_publish === false ? 'Sans notification' : item.notified_at ? 'Notifiée' : state === 'scheduled' ? 'Notification programmée' : 'Notification en attente'}</span></div><h3>{item.title}</h3><small>{state === 'scheduled' ? `Publication prévue le ${new Date(item.publish_at).toLocaleString('fr-FR')} · ${formatPeriod(item)}` : formatPeriod(item)}</small></div><div className="admin-content-actions"><button type="button" className="ghost-button" disabled={busy} onClick={() => beginEdit(item)}>Modifier</button>{state !== 'published' && <button type="button" className="ghost-button" disabled={busy} onClick={() => setPublishedNow(item)}>Publier maintenant</button>}{state !== 'draft' && <button type="button" className="ghost-button" disabled={busy} onClick={() => unpublishItem(item)}>Dépublier</button>}{due && item.notified_at && <button type="button" className="ghost-button" disabled={busy} onClick={() => resendNotification(item)}>Renvoyer notification</button>}<button type="button" className="ghost-button admin-danger-button" disabled={busy} onClick={() => removeItem(item)}>Supprimer</button></div></article>
        })}</div>}
      </section>
    </>}
  </div>
}
