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
  military: 'Militaires uniquement',
  amicaliste: 'Amicalistes uniquement',
}

const safeName = (name) => name
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/-+/g, '-')
  .toLowerCase()

export default function AdminContent() {
  const { user, isAdmin, loading: authLoading } = useAuth()
  const [type, setType] = useState('news')
  const [audience, setAudience] = useState('everyone')
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
      .order(type === 'news' ? 'published_at' : 'created_at', { ascending: false })
      .limit(8)
    if (loadError) setError(loadError.message)
    setRecent(data || [])
    setLoadingRecent(false)
  }

  useEffect(() => { loadRecent() }, [type, isAdmin])

  if (!authLoading && !isAdmin) return <Navigate to="/" replace />

  const reset = () => {
    setTitle('')
    setSummary('')
    setContent('')
    setLocation('')
    setStartsAt('')
    setEndsAt('')
    setTakenAt('')
    setFile(null)
    const input = document.getElementById('admin-content-file')
    if (input) input.value = ''
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

    try {
      if (!title.trim()) throw new Error('Ajoutez un titre.')

      if (type === 'news') {
        const { error: insertError } = await supabase.from('news').insert({
          title: title.trim(),
          summary: summary.trim() || null,
          content: content.trim() || null,
          audience,
          published: true,
          created_by: user.id,
        })
        if (insertError) throw insertError
      }

      if (type === 'events') {
        if (!startsAt) throw new Error('Indiquez la date et l’heure de début.')
        const { error: insertError } = await supabase.from('events').insert({
          title: title.trim(),
          description: content.trim() || null,
          location: location.trim() || null,
          starts_at: new Date(startsAt).toISOString(),
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
          audience,
          created_by: user.id,
        })
        if (insertError) throw insertError
      }

      if (type === 'documents') {
        bucket = 'documents'
        uploaded = await uploadPrivateFile(bucket)
        const { error: insertError } = await supabase.from('documents').insert({
          title: title.trim(),
          description: content.trim() || null,
          storage_path: uploaded,
          audience,
          created_by: user.id,
        })
        if (insertError) throw insertError
      }

      if (type === 'gallery') {
        if (file && !file.type.startsWith('image/')) throw new Error('Choisissez une image pour la galerie.')
        bucket = 'gallery'
        uploaded = await uploadPrivateFile(bucket)
        const { error: insertError } = await supabase.from('gallery').insert({
          title: title.trim(),
          storage_path: uploaded,
          image_url: null,
          taken_at: takenAt || null,
          audience,
          created_by: user.id,
        })
        if (insertError) throw insertError
      }

      setSuccess(`${typeLabels[type]} publié(e) pour : ${audienceLabels[audience]}. La notification suit la même audience.`)
      reset()
      await loadRecent()
    } catch (err) {
      if (uploaded && bucket) await supabase.storage.from(bucket).remove([uploaded])
      setError(err.message || 'Impossible de publier ce contenu.')
    } finally {
      setBusy(false)
    }
  }

  const removeItem = async (item) => {
    if (!window.confirm(`Supprimer « ${item.title || typeLabels[type]} » ?`)) return
    setError('')
    if (type === 'documents' && item.storage_path) await supabase.storage.from('documents').remove([item.storage_path])
    if (type === 'gallery' && item.storage_path) await supabase.storage.from('gallery').remove([item.storage_path])
    const { error: deleteError } = await supabase.from(type).delete().eq('id', item.id)
    if (deleteError) setError(deleteError.message)
    else await loadRecent()
  }

  return <>
    <PageTitle
      eyebrow="Administration"
      title="Publier du contenu"
      text="Publiez une information et choisissez précisément qui peut la voir et recevoir sa notification."
    />

    <div className="text-panel">
      <form onSubmit={submit}>
        <label>Type de contenu
          <select value={type} onChange={(e) => { setType(e.target.value); setSuccess(''); setError('') }}>
            <option value="news">Actualité</option>
            <option value="events">Événement</option>
            <option value="documents">Document</option>
            <option value="gallery">Photo / Galerie</option>
          </select>
        </label>

        <label>Audience
          <select value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="everyone">Tout le monde</option>
            <option value="military">Militaires uniquement</option>
            <option value="amicaliste">Amicalistes uniquement</option>
          </select>
        </label>

        <div className="privacy-note">🔒 Le filtrage est appliqué côté serveur. Les utilisateurs hors audience ne voient pas la publication et ne reçoivent pas sa notification.</div>

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
          <label>Début
            <input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label>Fin (facultatif)
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
        </>}

        {type === 'gallery' && <label>Date de la photo (facultatif)
          <input type="date" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} />
        </label>}

        {(type === 'documents' || type === 'gallery') && <label>{type === 'documents' ? 'Fichier' : 'Photo'}
          <input id="admin-content-file" type="file" required accept={type === 'gallery' ? 'image/*' : undefined} onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>}

        {error && <div className="alert error">{error}</div>}
        {success && <div className="alert">{success}</div>}

        <button className="primary-button" disabled={busy}>{busy ? 'Publication…' : `Publier ${typeLabels[type].toLowerCase()}`}</button>
      </form>
    </div>

    <div className="text-panel" style={{marginTop:'1.25rem'}}>
      <h2>Publications récentes — {typeLabels[type]}</h2>
      {loadingRecent ? <div className="skeleton-card" /> : recent.length === 0 ? <div className="empty-state">Aucune publication dans cette catégorie.</div> : (
        <div className="document-list">
          {recent.map((item) => <article className="document-row" key={item.id}>
            <div>
              <h3>{item.title || 'Sans titre'}</h3>
              <p><span className="role-badge">{audienceLabels[item.audience] || 'Tout le monde'}</span></p>
              {type === 'events' && item.starts_at && <small>{new Date(item.starts_at).toLocaleString('fr-FR')}</small>}
              {type !== 'events' && <small>{new Date(item.published_at || item.created_at).toLocaleDateString('fr-FR')}</small>}
            </div>
            <button type="button" className="ghost-button" onClick={() => removeItem(item)}>Supprimer</button>
          </article>)}
        </div>
      )}
    </div>
  </>
}
