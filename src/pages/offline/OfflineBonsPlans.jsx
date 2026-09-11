import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { readOfflineEntry } from '../../lib/offlineCache.js'
import { listOfflineMutations, queueOfflineMutation } from '../../lib/offlineMutations.js'
import { PageTitle } from '../Actualites.jsx'
import '../../offline-v2.css'

const CATEGORIES = {
  restaurant: ['Restaurants & gourmandises', '🍴'], loisirs: ['Sorties & loisirs', '🎟️'], nature: ['Nature & plages', '🌴'], famille: ['Famille', '👨‍👩‍👧‍👦'], shopping: ['Shopping & commerces', '🛍️'], bien_etre: ['Bien-être & sport', '🌿'], services: ['Services & pratique', '🧰'], hebergement: ['Hébergements & escapades', '🏡'], autre: ['Autres bons plans', '✨'],
}
const EMPTY_FORM = { title: '', category: 'restaurant', description: '', offer_text: '', address: '', municipality: '', phone: '', email: '', website_url: '', change_note: '' }
const isExpired = (deal) => Boolean(deal.valid_until && new Date(`${deal.valid_until}T23:59:59`).getTime() < Date.now())
const normalizeUrl = (value) => !value ? null : /^https?:\/\//i.test(value) ? value : `https://${value}`
const dealToForm = (deal) => ({
  title: deal.title || '', category: deal.category || 'autre', description: deal.description || '', offer_text: deal.offer_text || '', address: deal.address || '', municipality: deal.municipality || '', phone: deal.phone || '', email: deal.email || '', website_url: deal.website_url || '', change_note: '',
})

export default function OfflineBonsPlans() {
  const { user } = useAuth()
  const entry = readOfflineEntry(user?.id, 'good-deals')
  const items = entry?.data || []
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [editor, setEditor] = useState(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const refreshQueue = async () => {
    if (!user?.id) return setPendingCount(0)
    const rows = await listOfflineMutations(user.id).catch(() => [])
    setPendingCount(rows.filter((row) => row.type === 'good_deal_submission').length)
  }

  useEffect(() => {
    refreshQueue()
    const onQueue = () => refreshQueue()
    window.addEventListener('danz-offline-queue-changed', onQueue)
    return () => window.removeEventListener('danz-offline-queue-changed', onQueue)
  }, [user?.id])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => !isExpired(item)).filter((item) => {
      if (category !== 'all' && item.category !== category) return false
      if (!q) return true
      return [item.title, item.description, item.offer_text, item.address, item.municipality, CATEGORIES[item.category]?.[0]].filter(Boolean).join(' ').toLowerCase().includes(q)
    }).sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'fr'))
  }, [items, search, category])

  const openNew = () => {
    setEditor({ mode: 'new', target: null, form: { ...EMPTY_FORM } })
    setMessage('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const openUpdate = (deal) => {
    setEditor({ mode: 'update', target: deal, form: dealToForm(deal) })
    setMessage('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const queueRemoval = async (deal) => {
    if (!user?.id || !window.confirm(`Enregistrer hors ligne le signalement de suppression/fermeture de « ${deal.title} » ?`)) return
    setError('')
    setMessage('')
    try {
      await queueOfflineMutation({
        userId: user.id,
        type: 'good_deal_submission',
        payload: {
          submission_type: 'remove', target_deal_id: deal.id, change_note: 'Suppression ou fermeture signalée hors ligne.',
          title: deal.title, category: deal.category || 'autre', description: deal.description || null, offer_text: deal.offer_text || null,
          address: deal.address || null, municipality: deal.municipality || null, phone: deal.phone || null, email: deal.email || null, website_url: deal.website_url || null,
        },
      })
      setMessage('Signalement enregistré sur cet appareil. Il sera transmis au bureau à la reconnexion.')
    } catch (queueError) {
      setError(queueError.message || 'Impossible d’enregistrer ce signalement hors ligne.')
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!user?.id || !editor) return
    const form = editor.form
    if (!form.title.trim()) return setError('Le titre est obligatoire.')
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await queueOfflineMutation({
        userId: user.id,
        type: 'good_deal_submission',
        payload: {
          submission_type: editor.mode,
          target_deal_id: editor.target?.id || null,
          change_note: form.change_note.trim() || null,
          title: form.title.trim(), category: form.category,
          description: form.description.trim() || null, offer_text: form.offer_text.trim() || null,
          address: form.address.trim() || null, municipality: form.municipality.trim() || null,
          phone: form.phone.trim() || null, email: form.email.trim().toLowerCase() || null,
          website_url: normalizeUrl(form.website_url.trim()),
        },
      })
      setEditor(null)
      setMessage(editor.mode === 'update' ? 'Modification enregistrée hors ligne. Elle sera transmise au bureau automatiquement.' : 'Bon plan enregistré hors ligne. Il sera envoyé au bureau automatiquement à la reconnexion.')
    } catch (queueError) {
      setError(queueError.message || 'Impossible d’enregistrer cette proposition hors ligne.')
    } finally {
      setSaving(false)
    }
  }

  const changeForm = (field, value) => setEditor((current) => current ? ({ ...current, form: { ...current.form, [field]: value } }) : current)

  return <>
    <PageTitle eyebrow="Mode hors ligne" title="Bons plans" text="Les fiches synchronisées restent consultables sans réseau. Vous pouvez aussi préparer un nouveau bon plan, une correction ou un signalement : l’envoi se fera automatiquement à la reconnexion." />
    <div className="offline-v2-notice"><strong>Mode hors ligne</strong><span>{entry?.savedAt ? `Copie synchronisée le ${new Date(entry.savedAt).toLocaleString('fr-FR')}. ` : ''}{pendingCount ? `${pendingCount} proposition${pendingCount > 1 ? 's' : ''} en attente d’envoi. ` : ''}La carte et les sites externes restent indisponibles sans Internet.</span></div>
    <div className="offline-action-row"><button type="button" className="secondary-button" onClick={openNew}>＋ Proposer un bon plan hors ligne</button></div>
    {message && <div className="alert success offline-action-alert">{message}</div>}
    {error && <div className="alert error offline-action-alert">{error}</div>}
    {editor && <OfflineProposalForm editor={editor} changeForm={changeForm} onSubmit={submit} onCancel={() => setEditor(null)} saving={saving} />}
    {!entry ? <div className="empty-state">Aucune copie des bons plans n’a encore été enregistrée sur cet appareil. Ouvrez le site une fois avec Internet pour préparer le mode hors ligne.</div> : <>
      <div className="offline-deals-toolbar">
        <label>Rechercher<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom, commune, avantage…" /></label>
        <label>Catégorie<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Toutes les catégories</option>{Object.entries(CATEGORIES).map(([value, [label, icon]]) => <option value={value} key={value}>{icon} {label}</option>)}</select></label>
      </div>
      <div className="offline-deals-count">{filtered.length} bon{filtered.length > 1 ? 's' : ''} plan{filtered.length > 1 ? 's' : ''} disponible{filtered.length > 1 ? 's' : ''}</div>
      <div className="offline-deals-grid">{filtered.map((deal) => <DealCard key={deal.id} deal={deal} onUpdate={openUpdate} onRemove={queueRemoval} />)}</div>
      {filtered.length === 0 && <div className="empty-state">Aucun bon plan ne correspond à cette recherche.</div>}
    </>}
  </>
}

function OfflineProposalForm({ editor, changeForm, onSubmit, onCancel, saving }) {
  const form = editor.form
  return <section className="text-panel offline-proposal-panel"><form onSubmit={onSubmit}><div className="offline-proposal-heading"><div><span className="eyebrow">Enregistré sur l’appareil</span><h2>{editor.mode === 'update' ? 'Proposer une modification' : 'Proposer un bon plan'}</h2></div><button type="button" className="ghost-button" onClick={onCancel}>Fermer</button></div>
    <div className="offline-proposal-grid">
      <label>Titre<input required maxLength="180" value={form.title} onChange={(event) => changeForm('title', event.target.value)} /></label>
      <label>Catégorie<select value={form.category} onChange={(event) => changeForm('category', event.target.value)}>{Object.entries(CATEGORIES).map(([value, [label, icon]]) => <option key={value} value={value}>{icon} {label}</option>)}</select></label>
      <label className="wide">Description<textarea rows="3" maxLength="1500" value={form.description} onChange={(event) => changeForm('description', event.target.value)} /></label>
      <label>Avantage / offre<input maxLength="300" value={form.offer_text} onChange={(event) => changeForm('offer_text', event.target.value)} /></label>
      <label>Commune<input maxLength="120" value={form.municipality} onChange={(event) => changeForm('municipality', event.target.value)} /></label>
      <label className="wide">Adresse<input maxLength="300" value={form.address} onChange={(event) => changeForm('address', event.target.value)} /></label>
      <label>Téléphone<input maxLength="60" value={form.phone} onChange={(event) => changeForm('phone', event.target.value)} /></label>
      <label>E-mail<input type="email" maxLength="250" value={form.email} onChange={(event) => changeForm('email', event.target.value)} /></label>
      <label className="wide">Site web<input maxLength="500" value={form.website_url} onChange={(event) => changeForm('website_url', event.target.value)} /></label>
      {editor.mode === 'update' && <label className="wide">Ce qui doit changer<textarea rows="2" maxLength="800" value={form.change_note} onChange={(event) => changeForm('change_note', event.target.value)} placeholder="Précisez la correction pour le bureau." /></label>}
    </div>
    <p className="login-help">La proposition reste uniquement sur cet appareil tant qu’il est hors ligne. Elle sera soumise avec votre compte dès que la connexion revient.</p>
    <button className="primary-button" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer pour synchronisation'}</button>
  </form></section>
}

function DealCard({ deal, onUpdate, onRemove }) {
  const [label, icon] = CATEGORIES[deal.category] || CATEGORIES.autre
  return <article className="offline-deal-card"><span className="offline-deal-category">{icon} {label}</span><h3>{deal.title}</h3>{deal.offer_text && <div className="offline-deal-offer">★ {deal.offer_text}</div>}{deal.description && <p>{deal.description}</p>}{(deal.address || deal.municipality) && <p className="offline-deal-location">📍 {[deal.address, deal.municipality].filter(Boolean).join(', ')}</p>}<div className="offline-deal-contacts">{deal.phone && <a href={`tel:${String(deal.phone).replace(/\s/g, '')}`}>☎ {deal.phone}</a>}{deal.email && <a href={`mailto:${deal.email}`}>✉ {deal.email}</a>}</div>{deal.valid_until && <small>Valable jusqu’au {new Date(`${deal.valid_until}T12:00:00`).toLocaleDateString('fr-FR')}</small>}<div className="offline-deal-actions"><button type="button" className="secondary-button" onClick={() => onUpdate(deal)}>Proposer une correction</button><button type="button" className="ghost-button" onClick={() => onRemove(deal)}>Signaler fermé / supprimer</button></div></article>
}
