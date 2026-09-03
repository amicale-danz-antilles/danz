import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../extra.css'

const CATEGORIES = [
  ['restaurant', 'Restaurants & gourmandises', '🍴'],
  ['loisirs', 'Sorties & loisirs', '🎟️'],
  ['nature', 'Nature & plages', '🌴'],
  ['famille', 'Famille', '👨‍👩‍👧‍👦'],
  ['shopping', 'Shopping & commerces', '🛍️'],
  ['bien_etre', 'Bien-être & sport', '🌿'],
  ['services', 'Services & pratique', '🧰'],
  ['hebergement', 'Hébergements & escapades', '🏡'],
  ['autre', 'Autres bons plans', '✨'],
]

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(([value, label, icon]) => [value, { label, icon }]))
const MARTINIQUE = { minLat: 14.35, maxLat: 14.95, minLng: -61.25, maxLng: -60.75 }
const EMPTY_FORM = {
  title: '', category: 'restaurant', description: '', offer_text: '', address: '', municipality: '',
  latitude: '', longitude: '', map_verified: false, phone: '', email: '', website_url: '', valid_until: '', audience: 'everyone',
}

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]))
const fullAddress = (deal) => [deal.address, deal.municipality, 'Martinique'].filter(Boolean).join(', ')
const normalizeUrl = (value) => !value ? null : /^https?:\/\//i.test(value) ? value : `https://${value}`
const isExpired = (deal) => Boolean(deal.valid_until && new Date(`${deal.valid_until}T23:59:59`).getTime() < Date.now())
const isMartiniqueCoords = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
  && Number(lat) >= MARTINIQUE.minLat && Number(lat) <= MARTINIQUE.maxLat
  && Number(lng) >= MARTINIQUE.minLng && Number(lng) <= MARTINIQUE.maxLng
const isMapEligible = (deal) => deal.map_verified === true && isMartiniqueCoords(deal.latitude, deal.longitude)

function navigationUrls(deal) {
  const query = encodeURIComponent(fullAddress(deal) || deal.title)
  const hasCoords = isMapEligible(deal)
  const coords = hasCoords ? `${deal.latitude},${deal.longitude}` : null
  return {
    apple: `https://maps.apple.com/?q=${query}`,
    google: `https://www.google.com/maps/search/?api=1&query=${hasCoords ? encodeURIComponent(coords) : query}`,
    waze: hasCoords
      ? `https://www.waze.com/ul?ll=${encodeURIComponent(coords)}&navigate=yes`
      : `https://www.waze.com/ul?q=${query}&navigate=yes`,
  }
}

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L)
  if (window.__danzLeafletPromise) return window.__danzLeafletPromise

  window.__danzLeafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-danz-leaflet]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      link.dataset.danzLeaflet = 'true'
      document.head.appendChild(link)
    }
    const existing = document.querySelector('script[data-danz-leaflet]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.L), { once: true })
      existing.addEventListener('error', reject, { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.dataset.danzLeaflet = 'true'
    script.onload = () => resolve(window.L)
    script.onerror = reject
    document.body.appendChild(script)
  })
  return window.__danzLeafletPromise
}

function GoodDealsMap({ deals }) {
  const elementRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const located = deals.filter(isMapEligible)

  useEffect(() => {
    let cancelled = false
    loadLeaflet().then((L) => {
      if (cancelled || !elementRef.current) return
      if (!mapRef.current) {
        mapRef.current = L.map(elementRef.current, {
          scrollWheelZoom: false,
          maxBounds: [[14.25, -61.35], [15.05, -60.65]],
          maxBoundsViscosity: 1,
        }).setView([14.6415, -61.0242], 10)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap',
        }).addTo(mapRef.current)
      }

      if (layerRef.current) layerRef.current.remove()
      layerRef.current = L.layerGroup().addTo(mapRef.current)
      const bounds = []

      located.forEach((deal) => {
        const lat = Number(deal.latitude)
        const lng = Number(deal.longitude)
        const urls = navigationUrls(deal)
        const category = CATEGORY_MAP[deal.category] || CATEGORY_MAP.autre
        const emailLink = deal.email ? `<a href="mailto:${escapeHtml(deal.email)}">E-mail</a>` : ''
        const popup = `
          <div class="deal-map-popup">
            <strong>${escapeHtml(category.icon)} ${escapeHtml(deal.title)}</strong>
            <span>${escapeHtml(fullAddress(deal))}</span>
            ${emailLink}
            <small>Ouvrir avec :</small>
            <div>
              <a href="${urls.apple}" target="_blank" rel="noopener noreferrer">Apple Plans</a>
              <a href="${urls.google}" target="_blank" rel="noopener noreferrer">Google Maps</a>
              <a href="${urls.waze}" target="_blank" rel="noopener noreferrer">Waze</a>
            </div>
          </div>`
        L.marker([lat, lng]).addTo(layerRef.current).bindPopup(popup)
        bounds.push([lat, lng])
      })

      if (bounds.length === 1) mapRef.current.setView(bounds[0], 15)
      else if (bounds.length > 1) mapRef.current.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 })
      else mapRef.current.setView([14.6415, -61.0242], 10)
      setTimeout(() => mapRef.current?.invalidateSize(), 50)
    }).catch(() => {})

    return () => { cancelled = true }
  }, [deals])

  useEffect(() => () => {
    mapRef.current?.remove()
    mapRef.current = null
  }, [])

  return <div className="good-deals-map-wrap">
    <div className="good-deals-map" ref={elementRef} aria-label="Carte interactive des bons plans vérifiés en Martinique" />
    {located.length === 0 && <div className="good-deals-map-empty">Aucune adresse suffisamment précise n’est actuellement validée pour la carte. Les bons plans restent consultables dans la liste ci-dessous.</div>}
  </div>
}

function DirectionsMenu({ deal, open, onToggle }) {
  if (!deal.address && !deal.municipality && !isMapEligible(deal)) return null
  const urls = navigationUrls(deal)
  return <div className="deal-directions">
    <button type="button" className="secondary-button" onClick={onToggle}>📍 Itinéraire</button>
    {open && <div className="deal-directions-menu">
      <span>Ouvrir avec</span>
      <a href={urls.apple} target="_blank" rel="noopener noreferrer"><img src="/danz/apple-logo.svg" alt="" /> Apple Plans</a>
      <a href={urls.google} target="_blank" rel="noopener noreferrer"><img src="/danz/google-logo.svg" alt="" /> Google Maps</a>
      <a href={urls.waze} target="_blank" rel="noopener noreferrer"><strong>W</strong> Waze</a>
    </div>}
  </div>
}

export default function BonsPlans() {
  const { user, isAdmin } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('recent')
  const [navOpen, setNavOpen] = useState(null)
  const [showAdmin, setShowAdmin] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [geocoding, setGeocoding] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data, error: loadError } = await supabase.from('good_deals').select('*').order('created_at', { ascending: false })
    if (loadError) setError(loadError.message)
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const availableItems = useMemo(() => isAdmin ? items : items.filter((item) => !isExpired(item)), [items, isAdmin])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const result = availableItems.filter((item) => {
      if (category !== 'all' && item.category !== category) return false
      if (!q) return true
      return [item.title, item.description, item.offer_text, item.address, item.municipality, item.email, CATEGORY_MAP[item.category]?.label]
        .filter(Boolean).join(' ').toLowerCase().includes(q)
    })
    return [...result].sort((a, b) => {
      if (sort === 'alpha') return a.title.localeCompare(b.title, 'fr')
      if (sort === 'expiry') {
        const av = a.valid_until ? new Date(a.valid_until).getTime() : Infinity
        const bv = b.valid_until ? new Date(b.valid_until).getTime() : Infinity
        return av - bv
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [availableItems, category, search, sort])

  const geocode = async (nextForm = form) => {
    const query = [nextForm.address, nextForm.municipality, 'Martinique'].filter(Boolean).join(', ')
    if (!nextForm.address.trim()) return { latitude: null, longitude: null, map_verified: false }
    setGeocoding(true)
    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        limit: '3',
        addressdetails: '1',
        countrycodes: 'fr',
        bounded: '1',
        viewbox: '-61.25,14.95,-60.75,14.35',
        q: query,
      })
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { 'Accept-Language': 'fr' },
      })
      if (!response.ok) throw new Error('Service de localisation indisponible.')
      const data = await response.json()
      const match = (data || []).find((item) => {
        const lat = Number(item.lat)
        const lng = Number(item.lon)
        return isMartiniqueCoords(lat, lng)
          && Number(item.place_rank || 0) >= 20
          && String(item.display_name || '').toLowerCase().includes('martinique')
      })
      if (!match) {
        setForm((current) => ({ ...current, latitude: '', longitude: '', map_verified: false }))
        throw new Error('Adresse trop imprécise pour être placée de façon fiable en Martinique. Elle restera visible dans la liste mais pas sur la carte.')
      }
      const coords = { latitude: Number(match.lat), longitude: Number(match.lon), map_verified: true }
      setForm((current) => ({ ...current, latitude: String(coords.latitude), longitude: String(coords.longitude), map_verified: true }))
      return coords
    } finally {
      setGeocoding(false)
    }
  }

  const resetForm = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError('')
  }

  const beginEdit = (item) => {
    setEditing(item)
    setShowAdmin(true)
    setForm({
      title: item.title || '', category: item.category || 'autre', description: item.description || '', offer_text: item.offer_text || '',
      address: item.address || '', municipality: item.municipality || '', latitude: item.latitude ?? '', longitude: item.longitude ?? '',
      map_verified: item.map_verified === true, phone: item.phone || '', email: item.email || '', website_url: item.website_url || '',
      valid_until: item.valid_until || '', audience: item.audience || 'everyone',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      let latitude = form.latitude === '' ? null : Number(form.latitude)
      let longitude = form.longitude === '' ? null : Number(form.longitude)
      let mapVerified = form.map_verified === true

      if (Number.isFinite(latitude) || Number.isFinite(longitude)) {
        if (!isMartiniqueCoords(latitude, longitude)) {
          throw new Error('Ces coordonnées sont hors de la Martinique. Corrigez-les ou laissez-les vides pour ne pas afficher ce bon plan sur la carte.')
        }
        mapVerified = true
      }

      if (form.address.trim() && (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !mapVerified)) {
        try {
          const coords = await geocode(form)
          latitude = coords.latitude
          longitude = coords.longitude
          mapVerified = coords.map_verified
        } catch (_) {
          latitude = null
          longitude = null
          mapVerified = false
        }
      }

      const payload = {
        title: form.title.trim(),
        category: form.category,
        description: form.description.trim() || null,
        offer_text: form.offer_text.trim() || null,
        address: form.address.trim() || null,
        municipality: form.municipality.trim() || null,
        latitude,
        longitude,
        map_verified: mapVerified,
        phone: form.phone.trim() || null,
        email: form.email.trim().toLowerCase() || null,
        website_url: normalizeUrl(form.website_url.trim()),
        valid_until: form.valid_until || null,
        audience: form.audience,
      }

      const query = editing
        ? supabase.from('good_deals').update(payload).eq('id', editing.id)
        : supabase.from('good_deals').insert({ ...payload, created_by: user.id })
      const { error: saveError } = await query
      if (saveError) throw saveError

      setSuccess(editing ? 'Bon plan modifié.' : 'Bon plan ajouté.')
      resetForm()
      await load()
    } catch (err) {
      setError(err.message || 'Impossible d’enregistrer ce bon plan.')
    } finally {
      setSaving(false)
    }
  }

  const removeItem = async (item) => {
    if (!window.confirm(`Supprimer « ${item.title} » ?`)) return
    const { error: removeError } = await supabase.from('good_deals').delete().eq('id', item.id)
    if (removeError) setError(removeError.message)
    else await load()
  }

  return <>
    <PageTitle eyebrow="Martinique" title="Bons plans" text="Les bonnes adresses et idées utiles partagées par l’Amicale. La carte n’affiche que les positions vérifiées avec suffisamment de précision en Martinique." />

    {isAdmin && <div className="good-deals-admin-bar">
      <div><strong>Gestion des bons plans</strong><span>Ajoutez, corrigez ou supprimez les recommandations de l’application.</span></div>
      <button type="button" className="secondary-button" onClick={() => { setShowAdmin(!showAdmin); if (showAdmin) resetForm() }}>{showAdmin ? 'Fermer la gestion' : '＋ Ajouter / gérer'}</button>
    </div>}

    {isAdmin && showAdmin && <section className="good-deals-admin-panel">
      <h2>{editing ? 'Modifier le bon plan' : 'Ajouter un bon plan'}</h2>
      <form onSubmit={submit} className="good-deals-form">
        <label>Titre<input type="text" required maxLength="160" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>Rubrique<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map(([value, label, icon]) => <option key={value} value={value}>{icon} {label}</option>)}</select></label>
        <label className="full">Le bon plan / avantage<input type="text" maxLength="250" placeholder="Ex. -15 % sur présentation de la carte, menu intéressant, tarif local…" value={form.offer_text} onChange={(e) => setForm({ ...form, offer_text: e.target.value })} /></label>
        <label className="full">Description<textarea rows="4" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label>Adresse<input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value, latitude: '', longitude: '', map_verified: false })} /></label>
        <label>Commune<input type="text" placeholder="Fort-de-France, Le Marin…" value={form.municipality} onChange={(e) => setForm({ ...form, municipality: e.target.value, latitude: '', longitude: '', map_verified: false })} /></label>
        <div className="full good-deals-geocode-row">
          <button type="button" className="secondary-button" disabled={geocoding || !form.address.trim()} onClick={() => geocode().catch((err) => setError(err.message))}>{geocoding ? 'Localisation…' : '📍 Vérifier précisément cette adresse'}</button>
          {form.map_verified && form.latitude && form.longitude && <small>Position vérifiée : {Number(form.latitude).toFixed(5)}, {Number(form.longitude).toFixed(5)}</small>}
        </div>
        <details className="full good-deals-advanced"><summary>Coordonnées avancées (uniquement si vous connaissez la position exacte)</summary><div><label>Latitude<input type="number" step="any" min={MARTINIQUE.minLat} max={MARTINIQUE.maxLat} value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value, map_verified: false })} /></label><label>Longitude<input type="number" step="any" min={MARTINIQUE.minLng} max={MARTINIQUE.maxLng} value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value, map_verified: false })} /></label></div></details>
        <label>Téléphone<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label>E-mail<input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Site internet<input type="text" inputMode="url" placeholder="www.exemple.fr" value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })} /></label>
        <label>Valable jusqu’au (facultatif)<input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></label>
        <label>Audience<select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}><option value="everyone">Tout le monde</option><option value="military">Militaires DANZ uniquement</option><option value="amicaliste">Amicalistes uniquement</option><option value="admin">Bureau / Admin uniquement</option></select></label>
        {error && <div className="alert error full">{error}</div>}
        {success && <div className="alert full">{success}</div>}
        <div className="full good-deals-form-actions"><button className="primary-button" disabled={saving}>{saving ? 'Enregistrement…' : editing ? 'Enregistrer les modifications' : 'Ajouter le bon plan'}</button>{editing && <button type="button" className="secondary-button" onClick={resetForm}>Annuler</button>}</div>
      </form>
    </section>}

    <section className="good-deals-tools">
      <input type="search" placeholder="Rechercher un lieu, une commune, une activité…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Trier les bons plans"><option value="recent">Plus récents</option><option value="alpha">A → Z</option><option value="expiry">Fin de validité</option></select>
    </section>

    <div className="good-deals-categories" role="list" aria-label="Rubriques de bons plans">
      <button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Tous</button>
      {CATEGORIES.map(([value, label, icon]) => <button key={value} className={category === value ? 'active' : ''} onClick={() => setCategory(value)}>{icon} {label}</button>)}
    </div>

    <GoodDealsMap deals={filtered} />

    {loading ? <div className="skeleton-card tall" /> : filtered.length === 0 ? <div className="empty-state">Aucun bon plan ne correspond à cette recherche pour le moment.</div> : <div className="good-deals-grid">
      {filtered.map((deal) => {
        const cat = CATEGORY_MAP[deal.category] || CATEGORY_MAP.autre
        const expired = isExpired(deal)
        return <article className={`good-deal-card ${expired ? 'expired' : ''}`} key={deal.id}>
          <div className="good-deal-card-top"><span className="good-deal-category">{cat.icon} {cat.label}</span>{expired && <span className="role-badge">Expiré</span>}</div>
          <h2>{deal.title}</h2>
          {deal.offer_text && <div className="good-deal-offer">★ {deal.offer_text}</div>}
          {deal.description && <p>{deal.description}</p>}
          {(deal.address || deal.municipality) && <p className="good-deal-address">📍 {[deal.address, deal.municipality].filter(Boolean).join(', ')}</p>}
          {deal.valid_until && <small>Valable jusqu’au {new Date(`${deal.valid_until}T12:00:00`).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</small>}
          <div className="good-deal-actions">
            <DirectionsMenu deal={deal} open={navOpen === deal.id} onToggle={() => setNavOpen(navOpen === deal.id ? null : deal.id)} />
            {deal.phone && <a className="secondary-button" href={`tel:${deal.phone.replace(/\s/g,'')}`}>☎ Appeler</a>}
            {deal.email && <a className="secondary-button" href={`mailto:${deal.email}`}>✉ Envoyer un e-mail</a>}
            {deal.website_url && <a className="secondary-button" href={deal.website_url} target="_blank" rel="noopener noreferrer">Site web ↗</a>}
          </div>
          {isAdmin && <div className="good-deal-admin-actions"><button type="button" onClick={() => beginEdit(deal)}>Modifier</button><button type="button" onClick={() => removeItem(deal)}>Supprimer</button></div>}
        </article>
      })}
    </div>}
  </>
}
