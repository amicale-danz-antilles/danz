import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'

const typeLabels = {
  news: 'Actualité',
  events: 'Événement',
  documents: 'Document',
  gallery: 'Photo',
}

const audienceLabels = {
  everyone: 'Tout le monde',
  military: 'Militaires DANZ uniquement',
  amicaliste: 'Amicalistes uniquement',
  admin: 'Bureau / Admin uniquement',
}

const safeName = (name) => name
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/-+/g, '-')
  .toLowerCase()

const toLocalInput = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export default function AdminContent() {
  const { user, isAdmin, loading: authLoading } = useAuth()
  const [type, setType] = useState('news')
  const [editingItem, setEditingItem] = useState(null)
  const [audience, setAudience] = useState('everyone')
  const [publishMode, setPublishMode] = useState('now')
  const [publishAt, setPublishAt] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [content, setContent] = useState('')
  const [location, setLocation] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [takenAt, setTakenAt] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [recent, setRecent] = useState([])
  const [loadingRecent, setLoadingRecent] = useState(false)

  const loadRecent = async () => {
    if (!isAdmin) return
    setLoadingRecent(true)
    const { data, error: loadError } = await supabase
      .from(type)
      .select('*')
      .order('publish_at', { ascending: false })
      .limit(20)
    if (loadError) setError(loadError.message)
    setRecent(data || [])
    setLoadingRecent(false)
  }

  useEffect(() => { loadRecent() }, [type, isAdmin])

  if (!authLoading && !isAdmin) return <Navigate to="/" replace />

  const clearFile = () => {
    setFile(null)
    const input = document.getElementById('admin-content-file')
    if (input) input.value = ''
  }

  const reset = () => {
    setEditingItem(null)
    setAudience('everyone')
    setTitle('')
    setSummary('')
    setContent('')
    setLocation('')
    setStartsAt('')
    setEndsAt('')
    setTakenAt('')
    setPublishMode('now')
    setPublishAt('')
    clearFile()
  }

  const beginEdit = (item) => {
    setEditingItem(item)
    setAudience(item.audience || 'everyone')
    setPublishMode('keep')
    setPublishAt('')
    setTitle(item.title || '')
    setSummary(type === 'news' ? (item.summary || '') : '')
    setContent(type === 'news' ? (item.content || '') : type === 'events' ? (item.description || '') : type === 'documents' ? (item.description || '') : '')
    setLocation(type === 'events' ? (item.location || '') : '')
    setStartsAt(type === 'events' ? toLocalInput(item.starts_at) : '')
    setEndsAt(type === 'events' ? toLocalInput(item.ends_at) : '')
    setTakenAt(type === 'gallery' ? (item.taken_at || '') : '')
    clearFile()
    setError('')
    setSuccess('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const uploadPrivateFile = async (bucket) => {
    if (!file) throw new Error('Choisissez un fichier à envoyer.')
    const path = `${user.id}/${Date.now()}-${safeName(file.name || 'fichier')}`
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })
    if (uploadError) throw uploadError
    return path
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    let uploaded = null
    let bucket = null
    let oldStorageToRemove = null

    try {
      if (!title.trim()) throw new Error('Ajoutez un titre.')

      let publicationDate
      let publicationIso
      let resetNotification = false

      if (editingItem && publishMode === 'keep') {
        publicationIso = editingItem.publish_at || new Date().toISOString()
        publicationDate = new Date(publicationIso)
      } else if (publishMode === 'later') {
        if (!publishAt) throw new Error('Choisissez la date et l’heure de publication.')
        publicationDate = new Date(publishAt)
        if (Number.isNaN(publicationDate.getTime())) throw new Error('Date de publication invalide.')
        if (publicationDate.getTime() <= Date.now() + 30000) throw new Error('Choisissez une heure de publication dans le futur.')
        publicationIso = publicationDate.toISOString()
        resetNotification = Boolean(editingItem)
      } else {
        publicationDate = new Date()
        publicationIso = publicationDate.toISOString()
        if (editingItem && editingItem.publish_at && new Date(editingItem.publish_at).getTime() > Date.now()) resetNotification = true
      }

      if (type === 'news') {
        const payload = {
          title: title.trim(),
          summary: summary.trim() || null,
          content: content.trim() || null,
          audience,
          published: true,
          publish_at: publicationIso,
        }
        if (!editingItem || publishMode !== 'keep') payload.published_at = publicationIso
        if (resetNotification) payload.notified_at = null

        const query = editingItem
          ? supabase.from('news').update(payload).eq('id', editingItem.id)
          : supabase.from('news').insert({ ...payload, published_at: publicationIso, created_by: user.id })
        const { error: saveError } = await query
        if (saveError) throw saveError
      }

      if (type === 'events') {
        if (!startsAt) throw new Error('Indiquez la date et l’heure de début.')
        const startDate = new Date(startsAt)
        const endDate = endsAt ? new Date(endsAt) : null
        if (Number.isNaN(startDate.getTime())) throw new Error('Date de début invalide.')
        if (endDate && Number.isNaN(endDate.getTime())) throw new Error('Date de fin invalide.')
        if (endDate && endDate <= startDate) throw new Error('La fin de l’événement doit être après son début.')

        const payload = {
          title: title.trim(),
          description: content.trim() || null,
          location: location.trim() || null,
          starts_at: startDate.toISOString(),
          ends_at: endDate ? endDate.toISOString() : null,
          audience,
          publish_at: publicationIso,
        }
        if (resetNotification) payload.notified_at = null

        const query = editingItem
          ? supabase.from('events').update(payload).eq('id', editingItem.id)
          : supabase.from('events').insert({ ...payload, created_by: user.id })
        const { error: saveError } = await query
        if (saveError) throw saveError
      }

      if (type === 'documents') {
        if (file) {
          bucket = 'documents'
          uploaded = await uploadPrivateFile(bucket)
        }
        if (!editingItem && !uploaded) throw new Error('Choisissez un fichier à envoyer.')

        const payload = {
          title: title.trim(),
          description: content.trim() || null,
          audience,
          publish_at: publicationIso,
          storage_path: uploaded || editingItem?.storage_path,
        }
        if (resetNotification) payload.notified_at = null

        const query = editingItem
          ? supabase.from('documents').update(payload).eq('id', editingItem.id)
          : supabase.from('documents').insert({ ...payload, created_by: user.id })
        const { error: saveError } = await query
        if (saveError) throw saveError
        if (editingItem && uploaded && editingItem.storage_path && uploaded !== editingItem.storage_path) oldStorageToRemove = editingItem.storage_path
      }

      if (type === 'gallery') {
        if (file && !file.type.startsWith('image/')) throw new Error('Choisissez une image pour la galerie.')
        if (file) {
          bucket = 'gallery'
          uploaded = await uploadPrivateFile(bucket)
        }
        if (!editingItem && !uploaded) throw new Error('Choisissez une photo à envoyer.')

        const payload = {
          title: title.trim(),
          taken_at: takenAt || null,
          audience,
          publish_at: publicationIso,
        }
        if (uploaded) {
          payload.storage_path = uploaded
          payload.image_url = null
        }
        if (resetNotification) payload.notified_at = null

        const query = editingItem
          ? supabase.from('gallery').update(payload).eq('id', editingItem.id)
          : supabase.from('gallery').insert({ ...payload, storage_path: uploaded, image_url: null, created_by: user.id })
        const { error: saveError } = await query
        if (saveError) throw saveError
        if (editingItem && uploaded && editingItem.storage_path && uploaded !== editingItem.storage_path) oldStorageToRemove = editingItem.storage_path
      }

      if (oldStorageToRemove && bucket) await supabase.storage.from(bucket).remove([oldStorageToRemove])

      if (editingItem) {
        if (publishMode === 'later') {
          setSuccess(`${typeLabels[type]} modifié(e) et reprogrammé(e) pour le ${publicationDate.toLocaleString('fr-FR')}. La notification partira au nouvel horaire.`)
        } else if (publishMode === 'keep') {
          setSuccess(`${typeLabels[type]} modifié(e). La date de publication est conservée et aucune nouvelle notification n’est envoyée.`)
        } else {
          setSuccess(`${typeLabels[type]} modifié(e) et rendu(e) visible maintenant.`)
        }
      } else {
        const timingText = publishMode === 'later'
          ? `programmé(e) pour le ${publicationDate.toLocaleString('fr-FR')}`
          : 'publié(e) maintenant'
        setSuccess(`${typeLabels[type]} ${timingText} pour : ${audienceLabels[audience]}.`)
      }

      reset()
      await loadRecent()
    } catch (err) {
      if (uploaded && bucket) await supabase.storage.from(bucket).remove([uploaded])
      setError(err.message || 'Impossible d’enregistrer ce contenu.')
    } finally {
      setBusy(false)
    }
  }

  const removeItem = async (item) => {
    if (!window.confirm(`Supprimer « ${item.title || typeLabels[type]} » ?`)) return
    setError('')
    const { error: deleteError } = await supabase.from(type).delete().eq('id', item.id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    if (type === 'documents' && item.storage_path) await supabase.storage.from('documents').remove([item.storage_path])
    if (type === 'gallery' && item.storage_path) await supabase.storage.from('gallery').remove([item.storage_path])
    if (editingItem?.id === item.id) reset()
    await loadRecent()
  }

  return <>
    <PageTitle
      eyebrow="Administration"
      title="Publier et gérer le contenu"
      text="Publiez, programmez ou corrigez à tout moment une actualité, un événement, un document ou une photo."
    />

    <div className="text-panel">
      <form onSubmit={submit}>
        {editingItem && <div className="alert"><strong>Mode modification :</strong> {editingItem.title || typeLabels[type]}. Vous pouvez corriger cette publication même si elle est déjà diffusée.</div>}

        <label>Type de contenu
          <select value={type} disabled={Boolean(editingItem)} onChange={(e) => { reset(); setType(e.target.value); setSuccess(''); setError('') }}>
            <option value="news">Actualité</option>
            <option value="events">Événement</option>
            <option value="documents">Document</option>
            <option value="gallery">Photo / Galerie</option>
          </select>
        </label>

        <label>Audience
          <select value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="everyone">Tout le monde</option>
            <option value="military">Militaires DANZ uniquement</option>
            <option value="amicaliste">Amicalistes uniquement</option>
            <option value="admin">Bureau / Admin uniquement</option>
          </select>
        </label>

        <label>Publication
          <select value={publishMode} onChange={(e) => { setPublishMode(e.target.value); if (e.target.value !== 'later') setPublishAt('') }}>
            {editingItem && <option value="keep">Conserver la date de publication actuelle</option>}
            <option value="now">{editingItem ? 'Rendre visible maintenant' : 'Publier maintenant'}</option>
            <option value="later">{editingItem ? 'Programmer / reprogrammer pour plus tard' : 'Programmer pour plus tard'}</option>
          </select>
        </label>

        {editingItem && publishMode === 'keep' && <div className="privacy-note">Date actuelle : {new Date(editingItem.publish_at || editingItem.created_at).toLocaleString('fr-FR')}. Une simple correction ne déclenche pas une nouvelle notification.</div>}

        {publishMode === 'later' && <label>Date et heure de publication
          <input type="datetime-local" required value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
        </label>}

        <div className="privacy-note">⏱ Une publication programmée reste invisible jusqu’à l’heure choisie. Si vous reprogrammez une publication déjà diffusée, elle redevient invisible jusqu’au nouvel horaire et une nouvelle notification sera envoyée à ce moment-là.</div>

        <label>Titre
          <input type="text" required maxLength="160" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        {type === 'news' && <label>Résumé
          <textarea rows="3" maxLength="500" value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>}

        {(type === 'news' || type === 'events' || type === 'documents') && <label>{type === 'news' ? 'Contenu' : type === 'events' ? 'Description' : 'Description du document'}
          <textarea rows="5" value={content} onChange={(e) => setContent(e.target.value)} />
        </label>}

        {type === 'events' && <>
          <label>Lieu
            <input type="text" maxLength="180" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label>Début de l’événement
            <input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label>Fin de l’événement (facultatif)
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
        </>}

        {type === 'gallery' && <label>Date de la photo (facultatif)
          <input type="date" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} />
        </label>}

        {(type === 'documents' || type === 'gallery') && <label>{editingItem ? (type === 'documents' ? 'Remplacer le fichier (facultatif)' : 'Remplacer la photo (facultatif)') : (type === 'documents' ? 'Fichier' : 'Photo')}
          <input id="admin-content-file" type="file" required={!editingItem} accept={type === 'gallery' ? 'image/*' : undefined} onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>}

        {error && <div className="alert error">{error}</div>}
        {success && <div className="alert">{success}</div>}

        <div style={{display:'flex',gap:'.65rem',flexWrap:'wrap'}}>
          <button className="primary-button" disabled={busy}>{busy ? 'Enregistrement…' : editingItem ? 'Enregistrer les modifications' : publishMode === 'later' ? `Programmer ${typeLabels[type].toLowerCase()}` : `Publier ${typeLabels[type].toLowerCase()}`}</button>
          {editingItem && <button type="button" className="ghost-button" disabled={busy} onClick={reset}>Annuler la modification</button>}
        </div>
      </form>
    </div>

    <div className="text-panel" style={{marginTop:'1.25rem'}}>
      <h2>Publications — {typeLabels[type]}</h2>
      {loadingRecent ? <div className="skeleton-card" /> : recent.length === 0 ? <div className="empty-state">Aucune publication dans cette catégorie.</div> : (
        <div className="document-list">
          {recent.map((item) => {
            const planned = item.publish_at && new Date(item.publish_at).getTime() > Date.now()
            return <article className="document-row" key={item.id}>
              <div>
                <h3>{item.title || 'Sans titre'}</h3>
                <p style={{display:'flex',gap:'.5rem',flexWrap:'wrap'}}>
                  <span className="role-badge">{audienceLabels[item.audience] || 'Tout le monde'}</span>
                  {planned && <span className="role-badge">Programmé</span>}
                </p>
                <small>{planned ? `Publication : ${new Date(item.publish_at).toLocaleString('fr-FR')}` : `Publié : ${new Date(item.publish_at || item.published_at || item.created_at).toLocaleString('fr-FR')}`}</small>
                {type === 'events' && item.starts_at && <small style={{display:'block'}}>Événement : {new Date(item.starts_at).toLocaleString('fr-FR')}</small>}
              </div>
              <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap'}}>
                <button type="button" className="ghost-button" onClick={() => beginEdit(item)}>Modifier</button>
                <button type="button" className="ghost-button" onClick={() => removeItem(item)}>Supprimer</button>
              </div>
            </article>
          })}
        </div>
      )}
    </div>
  </>
}
