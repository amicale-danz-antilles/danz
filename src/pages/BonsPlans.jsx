import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../extra.css'
import '../good-deals-submissions.css'

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
const EMPTY_PROPOSAL = {
  title: '', category: 'restaurant', description: '', offer_text: '', address: '', municipality: '',
  phone: '', email: '', website_url: '', change_note: '',
}

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]))
const fullAddress = (deal) => [deal.address, deal.municipality, 'Martinique'].filter(Boolean).join(', ')
const placeSearchText = (deal) => [deal.title, deal.address, deal.municipality, 'Martinique'].filter(Boolean).join(', ')
const normalizeUrl = (value) => !value ? null : /^https?:\/\//i.test(value) ? value : `https://${value}`
const isExpired = (deal) => Boolean(deal.valid_until && new Date(`${deal.valid_until}T23:59:59`).getTime() < Date.now())
const isMartiniqueCoords = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
  && Number(lat) >= MARTINIQUE.minLat && Number(lat) <= MARTINIQUE.maxLat
  && Number(lng) >= MARTINIQUE.minLng && Number(lng) <= MARTINIQUE.maxLng
const isMapEligible = (deal) => deal.map_verified === true && isMartiniqueCoords(deal.latitude, deal.longitude)
const googleSearchUrl = (deal) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeSearchText(deal))}`

const submissionTypeLabel = (type) => type === 'update'
  ? 'Modification proposée'
  : type === 'remove'
    ? 'Suppression / fermeture signalée'
    : 'Nouveau bon plan'

function navigationUrls(deal) {
  const query = encodeURIComponent(fullAddress(deal) || placeSearchText(deal))
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

async function lookupMartiniqueLocation(place) {
  const queries = [
    [place.address, place.municipality, 'Martinique'].filter(Boolean).join(', '),
    [place.title, place.address, place.municipality, 'Martinique'].filter(Boolean).join(', '),
    [place.title, place.municipality, 'Martinique'].filter(Boolean).join(', '),
    [place.title, 'Martinique'].filter(Boolean).join(', '),
  ].filter((value, index, array) => value.trim() && array.indexOf(value) === index)

  for (let stage = 0; stage < queries.length; stage += 1) {
    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: '5',
      addressdetails: '1',
      namedetails: '1',
      countrycodes: 'fr',
      bounded: '1',
      viewbox: '-61.25,14.95,-60.75,14.35',
      q: queries[stage],
    })
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'Accept-Language': 'fr' },
    })
    if (!response.ok) continue
    const data = await response.json()
    const match = (data || []).find((item) => {
      const lat = Number(item.lat)
      const lng = Number(item.lon)
      const rank = Number(item.place_rank || 0)
      const type = String(item.type || '')
      return isMartiniqueCoords(lat, lng)
        && rank >= (stage === 0 ? 20 : 16)
        && String(item.display_name || '').toLowerCase().includes('martinique')
        && !['administrative', 'island', 'region', 'state'].includes(type)
    })
    if (match) return { latitude: Number(match.lat), longitude: Number(match.lon), displayName: match.display_name }
  }
  return null
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
        const phone = deal.phone ? String(deal.phone).replace(/\s/g, '') : ''
        const popup = `
          <div class="deal-map-popup">
            <strong>${escapeHtml(category.icon)} ${escapeHtml(deal.title)}</strong>
            ${deal.offer_text ? `<div class="deal-map-offer">★ ${escapeHtml(deal.offer_text)}</div>` : ''}
            ${deal.description ? `<p>${escapeHtml(deal.description)}</p>` : ''}
            ${(deal.address || deal.municipality) ? `<span>📍 ${escapeHtml([deal.address, deal.municipality].filter(Boolean).join(', '))}</span>` : ''}
            <div class="deal-map-contacts">
              ${phone ? `<a href="tel:${escapeHtml(phone)}">☎ Appeler</a>` : ''}
              ${deal.email ? `<a href="mailto:${escapeHtml(deal.email)}">✉ E-mail</a>` : ''}
              ${deal.website_url ? `<a href="${escapeHtml(deal.website_url)}" target="_blank" rel="noopener noreferrer">Site web ↗</a>` : ''}
            </div>
            <small>Itinéraire :</small>
            <div>
              <a href="${urls.apple}" target="_blank" rel="noopener noreferrer">Apple Plans</a>
              <a href="${urls.google}" target="_blank" rel="noopener noreferrer">Google Maps</a>
              <a href="${urls.waze}" target="_blank" rel="noopener noreferrer">Waze</a>
            </div>
          </div>`
        L.marker([lat, lng]).addTo(layerRef.current).bindPopup(popup, { maxWidth: 320 })
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
  const [submissions, setSubmissions] = useState([])
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
  const [showProposal, setShowProposal] = useState(false)
  const [proposal, setProposal] = useState(EMPTY_PROPOSAL)
  const [proposalType, setProposalType] = useState('new')
  const [proposalTarget, setProposalTarget] = useState(null)
  const [proposalBusy, setProposalBusy] = useState(false)
  const [proposalLocation, setProposalLocation] = useState(null)
  const [reviewBusy, setReviewBusy] = useState(null)

  const load = async () => {
    setLoading(true)
    const [dealsResult, submissionsResult] = await Promise.all([
      supabase.from('good_deals').select('*').order('created_at', { ascending: false }),
      supabase.from('good_deal_submissions').select('*').order('submitted_at', { ascending: false }),
    ])
    if (dealsResult.error) setError(dealsResult.error.message)
    if (submissionsResult.error) setError(submissionsResult.error.message)
    setItems(dealsResult.data || [])
    setSubmissions(submissionsResult.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const availableItems = useMemo(() => isAdmin ? items : items.filter((item) => !isExpired(item)), [items, isAdmin])
  const pendingSubmissions = useMemo(() => submissions.filter((item) => item.status === 'pending'), [submissions])

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
    if (!nextForm.address.trim() && !nextForm.title.trim()) return { latitude: null, longitude: null, map_verified: false }
    setGeocoding(true)
    try {
      const match = await lookupMartiniqueLocation(nextForm)
      if (!match) {
        setForm((current) => ({ ...current, latitude: '', longitude: '', map_verified: false }))
        throw new Error('Lieu non retrouvé avec suffisamment de précision en Martinique. Il pourra rester dans la liste sans point carte.')
      }
      const coords = { latitude: match.latitude, longitude: match.longitude, map_verified: true }
      setForm((current) => ({ ...current, latitude: String(coords.latitude), longitude: String(coords.longitude), map_verified: true }))
      return coords
    } finally {
      setGeocoding(false)
    }
  }

  const resetProposal = () => {
    setProposal(EMPTY_PROPOSAL)
    setProposalType('new')
    setProposalTarget(null)
    setProposalLocation(null)
    setShowProposal(false)
  }

  const startNewProposal = () => {
    setProposal(EMPTY_PROPOSAL)
    setProposalType('new')
    setProposalTarget(null)
    setProposalLocation(null)
    setError('')
    setSuccess('')
    setShowProposal(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startChangeProposal = (deal) => {
    setProposal({
      title: deal.title || '',
      category: deal.category || 'autre',
      description: deal.description || '',
      offer_text: deal.offer_text || '',
      address: deal.address || '',
      municipality: deal.municipality || '',
      phone: deal.phone || '',
      email: deal.email || '',
      website_url: deal.website_url || '',
      change_note: '',
    })
    setProposalType('update')
    setProposalTarget(deal)
    setProposalLocation(null)
    setError('')
    setSuccess('')
    setShowProposal(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const previewProposal = async () => {
    setProposalBusy(true)
    setError('')
    try {
      const match = await lookupMartiniqueLocation(proposal)
      setProposalLocation(match)
      if (!match) setError('Cette adresse n’est pas encore reconnue avec précision. Vous pouvez quand même envoyer la proposition : un admin pourra la contrôler avant validation.')
    } catch (_) {
      setProposalLocation(null)
      setError('La vérification automatique de l’adresse n’est pas disponible pour le moment.')
    } finally {
      setProposalBusy(false)
    }
  }

  const submitProposal = async (event) => {
    event.preventDefault()
    setProposalBusy(true)
    setError('')
    setSuccess('')

    const payload = {
      submission_type: proposalType,
      target_deal_id: proposalTarget?.id || null,
      change_note: proposal.change_note.trim() || null,
      title: proposal.title.trim(),
      category: proposal.category,
      description: proposal.description.trim() || null,
      offer_text: proposal.offer_text.trim() || null,
      address: proposal.address.trim() || null,
      municipality: proposal.municipality.trim() || null,
      phone: proposal.phone.trim() || null,
      email: proposal.email.trim().toLowerCase() || null,
      website_url: normalizeUrl(proposal.website_url.trim()),
      submitted_by: user.id,
    }

    const { error: submitError } = await supabase.from('good_deal_submissions').insert(payload)
    if (submitError) setError(submitError.message)
    else {
      const message = proposalType === 'remove'
        ? 'Merci. Le signalement de fermeture/suppression a été envoyé au bureau. Le bon plan reste visible tant qu’un admin ne l’a pas validé.'
        : proposalType === 'update'
          ? 'Merci. Votre proposition de modification a été envoyée au bureau. La fiche actuelle reste inchangée jusqu’à validation.'
          : 'Merci ! Votre bon plan a été envoyé au bureau. Il apparaîtra dans l’application après validation par un administrateur.'
      setSuccess(message)
      resetProposal()
      await load()
    }
    setProposalBusy(false)
  }

  const approveSubmission = async (submission) => {
    setReviewBusy(submission.id)
    setError('')
    setSuccess('')

    let operationError = null
    if (submission.submission_type === 'remove') {
      if (!submission.target_deal_id) operationError = new Error('Le bon plan concerné n’existe plus.')
      else {
        const result = await supabase.from('good_deals').delete().eq('id', submission.target_deal_id)
        operationError = result.error
      }
    } else if (submission.submission_type === 'update') {
      if (!submission.target_deal_id) operationError = new Error('Le bon plan concerné est introuvable.')
      else {
        const result = await supabase.from('good_deals').update({
          title: submission.title,
          category: submission.category,
          description: submission.description,
          offer_text: submission.offer_text,
          address: submission.address,
          municipality: submission.municipality,
          phone: submission.phone,
          email: submission.email,
          website_url: submission.website_url,
        }).eq('id', submission.target_deal_id)
        operationError = result.error
      }
    } else {
      const result = await supabase.from('good_deals').insert({
        title: submission.title,
        category: submission.category,
        description: submission.description,
        offer_text: submission.offer_text,
        address: submission.address,
        municipality: submission.municipality,
        phone: submission.phone,
        email: submission.email,
        website_url: submission.website_url,
        audience: 'everyone',
        created_by: user.id,
      })
      operationError = result.error
    }

    if (operationError) {
      setError(operationError.message)
      setReviewBusy(null)
      return
    }

    const { error: updateError } = await supabase.from('good_deal_submissions').update({
      status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: user.id,
    }).eq('id', submission.id)

    if (updateError) setError(updateError.message)
    else {
      setSuccess(submission.submission_type === 'remove'
        ? `« ${submission.title} » a été retiré des bons plans.`
        : submission.submission_type === 'update'
          ? `Les modifications proposées pour « ${submission.title} » ont été appliquées. L’adresse sera revérifiée automatiquement si elle a changé.`
          : `« ${submission.title} » a été validé. Sa position est recalculée côté serveur avant d’apparaître sur la carte.`)
      await load()
    }
    setReviewBusy(null)
  }

  const rejectSubmission = async (submission) => {
    if (!window.confirm(`Refuser cette proposition concernant « ${submission.title} » ?`)) return
    setReviewBusy(submission.id)
    const { error: updateError } = await supabase.from('good_deal_submissions').update({
      status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: user.id,
    }).eq('id', submission.id)
    if (updateError) setError(updateError.message)
    else await load()
    setReviewBusy(null)
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
        if (!isMartiniqueCoords(latitude, longitude)) throw new Error('Ces coordonnées sont hors de la Martinique. Corrigez-les ou laissez-les vides.')
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

      setSuccess(editing ? 'Bon plan modifié. La position est revérifiée automatiquement si l’adresse a changé.' : 'Bon plan ajouté. La position est revérifiée automatiquement côté serveur.')
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
    <PageTitle eyebrow="Martinique" title="Bons plans" text="Les bonnes adresses et idées utiles partagées par l’Amicale. Les membres peuvent aussi signaler une information qui a changé ou un établissement qui n’existe plus." />

    <section className="good-deals-contribute-bar">
      <div><strong>Contribuer aux bons plans</strong><span>Proposez une nouvelle adresse ou signalez une fiche à mettre à jour. Toute modification est vérifiée par le bureau avant publication.</span></div>
      <button type="button" className="secondary-button" onClick={showProposal ? resetProposal : startNewProposal}>{showProposal ? 'Fermer' : '＋ Proposer un bon plan'}</button>
    </section>

    {showProposal && <section className="good-deals-admin-panel good-deals-proposal-panel">
      <h2>{proposalTarget ? `Proposer une modification — ${proposalTarget.title}` : 'Proposer un bon plan'}</h2>
      {proposalTarget ? <>
        <p className="muted">La fiche publiée ne changera pas tant qu’un administrateur n’aura pas validé votre proposition.</p>
        <label className="proposal-change-type">Que souhaitez-vous signaler ?
          <select value={proposalType} onChange={(e) => { setProposalType(e.target.value); setProposalLocation(null) }}>
            <option value="update">Des informations ont changé</option>
            <option value="remove">Ce bon plan n’existe plus / doit être retiré</option>
          </select>
        </label>
      </> : <p className="muted">Indiquez le nom exact du lieu et son adresse. La position est recherchée automatiquement en Martinique, puis recalculée côté serveur après validation par un admin.</p>}

      <form onSubmit={submitProposal} className="good-deals-form">
        {proposalTarget && <label className="full">Expliquez ce qui a changé
          <textarea rows="3" required={proposalType === 'remove'} placeholder={proposalType === 'remove' ? 'Ex. établissement fermé définitivement…' : 'Ex. nouvelle remise, changement de téléphone, nouvelle adresse…'} value={proposal.change_note} onChange={(e) => setProposal({ ...proposal, change_note: e.target.value })} />
        </label>}

        {proposalType !== 'remove' && <>
          <label>Nom du lieu<input required maxLength="160" value={proposal.title} onChange={(e) => { setProposal({ ...proposal, title: e.target.value }); setProposalLocation(null) }} /></label>
          <label>Rubrique<select value={proposal.category} onChange={(e) => setProposal({ ...proposal, category: e.target.value })}>{CATEGORIES.map(([value, label, icon]) => <option key={value} value={value}>{icon} {label}</option>)}</select></label>
          <label className="full">Le bon plan / avantage<input maxLength="250" placeholder="Réduction, tarif, avantage…" value={proposal.offer_text} onChange={(e) => setProposal({ ...proposal, offer_text: e.target.value })} /></label>
          <label className="full">Description<textarea rows="3" value={proposal.description} onChange={(e) => setProposal({ ...proposal, description: e.target.value })} /></label>
          <label>Adresse<input required value={proposal.address} onChange={(e) => { setProposal({ ...proposal, address: e.target.value }); setProposalLocation(null) }} placeholder="Numéro, rue, quartier…" /></label>
          <label>Commune<input required value={proposal.municipality} onChange={(e) => { setProposal({ ...proposal, municipality: e.target.value }); setProposalLocation(null) }} placeholder="Fort-de-France, Le Marin…" /></label>
          <div className="full proposal-location-check">
            <button type="button" className="secondary-button" disabled={proposalBusy || (!proposal.address.trim() && !proposal.title.trim())} onClick={previewProposal}>{proposalBusy ? 'Vérification…' : '📍 Vérifier la position'}</button>
            <a className="secondary-button" href={googleSearchUrl(proposal)} target="_blank" rel="noopener noreferrer">Comparer dans Google Maps ↗</a>
            {proposalLocation && <small>✓ Lieu repéré en Martinique : {proposalLocation.displayName}</small>}
          </div>
          <label>Téléphone<input type="tel" value={proposal.phone} onChange={(e) => setProposal({ ...proposal, phone: e.target.value })} /></label>
          <label>E-mail<input type="email" value={proposal.email} onChange={(e) => setProposal({ ...proposal, email: e.target.value })} /></label>
          <label className="full">Site internet<input type="text" inputMode="url" placeholder="www.exemple.fr" value={proposal.website_url} onChange={(e) => setProposal({ ...proposal, website_url: e.target.value })} /></label>
        </>}

        {proposalType === 'remove' && proposalTarget && <div className="full proposal-removal-summary">
          <strong>Fiche concernée : {proposalTarget.title}</strong>
          {(proposalTarget.address || proposalTarget.municipality) && <span>📍 {[proposalTarget.address, proposalTarget.municipality].filter(Boolean).join(', ')}</span>}
          <small>Elle restera visible jusqu’à validation du signalement par un administrateur.</small>
        </div>}

        <div className="full good-deals-form-actions">
          <button className="primary-button" disabled={proposalBusy}>{proposalBusy ? 'Envoi…' : 'Envoyer au bureau pour validation'}</button>
          {proposalTarget && <button type="button" className="secondary-button" onClick={resetProposal}>Annuler</button>}
        </div>
      </form>
    </section>}

    {success && <div className="alert" style={{marginBottom:'1rem'}}>{success}</div>}
    {error && <div className="alert error" style={{marginBottom:'1rem'}}>{error}</div>}

    {isAdmin && <div className="good-deals-admin-bar">
      <div><strong>Gestion des bons plans</strong><span>Ajoutez ou corrigez les fiches publiées. {pendingSubmissions.length ? `${pendingSubmissions.length} proposition${pendingSubmissions.length > 1 ? 's' : ''} à valider.` : 'Aucune proposition en attente.'}</span></div>
      <button type="button" className="secondary-button" onClick={() => { setShowAdmin(!showAdmin); if (showAdmin) resetForm() }}>{showAdmin ? 'Fermer la gestion' : '＋ Ajouter / gérer'}</button>
    </div>}

    {isAdmin && pendingSubmissions.length > 0 && <section className="good-deal-submissions-review">
      <div className="section-heading"><div><span className="eyebrow">Validation admin</span><h2>Propositions des membres</h2></div></div>
      <div className="submission-review-grid">
        {pendingSubmissions.map((submission) => {
          const cat = CATEGORY_MAP[submission.category] || CATEGORY_MAP.autre
          const target = submission.target_deal_id ? items.find((item) => item.id === submission.target_deal_id) : null
          return <article className={`submission-review-card submission-${submission.submission_type || 'new'}`} key={submission.id}>
            <span className="submission-type-badge">{submissionTypeLabel(submission.submission_type)}</span>
            <span className="good-deal-category">{cat.icon} {cat.label}</span>
            <h3>{submission.title}</h3>
            {target && <p className="submission-target"><strong>Fiche actuelle :</strong> {target.title}</p>}
            {submission.change_note && <div className="submission-change-note"><strong>Motif / changement signalé</strong><p>{submission.change_note}</p></div>}
            {submission.submission_type !== 'remove' && <>
              {submission.offer_text && <div className="good-deal-offer">★ {submission.offer_text}</div>}
              {submission.description && <p>{submission.description}</p>}
              {(submission.address || submission.municipality) && <p>📍 {[submission.address, submission.municipality].filter(Boolean).join(', ')}</p>}
              <div className="submission-contact-line">
                {submission.phone && <a href={`tel:${submission.phone.replace(/\s/g,'')}`}>☎ {submission.phone}</a>}
                {submission.email && <a href={`mailto:${submission.email}`}>✉ {submission.email}</a>}
                <a href={googleSearchUrl(submission)} target="_blank" rel="noopener noreferrer">Vérifier Google Maps ↗</a>
              </div>
            </>}
            {submission.submission_type === 'remove' && target && <p className="submission-removal-warning">⚠️ La validation retirera immédiatement cette fiche de l’application.</p>}
            <div className="good-deals-form-actions">
              <button className="primary-button" disabled={reviewBusy === submission.id} onClick={() => approveSubmission(submission)}>
                {reviewBusy === submission.id ? 'Traitement…' : submission.submission_type === 'remove' ? '✓ Confirmer le retrait' : submission.submission_type === 'update' ? '✓ Appliquer les modifications' : '✓ Valider et publier'}
              </button>
              <button className="secondary-button" disabled={reviewBusy === submission.id} onClick={() => rejectSubmission(submission)}>Refuser</button>
            </div>
          </article>
        })}
      </div>
    </section>}

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
          <button type="button" className="secondary-button" disabled={geocoding || (!form.address.trim() && !form.title.trim())} onClick={() => geocode().catch((err) => setError(err.message))}>{geocoding ? 'Localisation…' : '📍 Rechercher la position'}</button>
          <a className="secondary-button" href={googleSearchUrl(form)} target="_blank" rel="noopener noreferrer">Comparer dans Google Maps ↗</a>
          {form.map_verified && form.latitude && form.longitude && <small>Prévisualisation : {Number(form.latitude).toFixed(5)}, {Number(form.longitude).toFixed(5)}</small>}
        </div>
        <details className="full good-deals-advanced"><summary>Coordonnées avancées</summary><div><label>Latitude<input type="number" step="any" min={MARTINIQUE.minLat} max={MARTINIQUE.maxLat} value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value, map_verified: false })} /></label><label>Longitude<input type="number" step="any" min={MARTINIQUE.minLng} max={MARTINIQUE.maxLng} value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value, map_verified: false })} /></label></div></details>
        <label>Téléphone<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label>E-mail<input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Site internet<input type="text" inputMode="url" placeholder="www.exemple.fr" value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })} /></label>
        <label>Valable jusqu’au (facultatif)<input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></label>
        <label>Audience<select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}><option value="everyone">Tout le monde</option><option value="military">Militaires DANZ uniquement</option><option value="amicaliste">Amicalistes uniquement</option><option value="admin">Bureau / Admin uniquement</option></select></label>
        <div className="full good-deals-form-actions"><button className="primary-button" disabled={saving}>{saving ? 'Enregistrement…' : editing ? 'Enregistrer les modifications' : 'Ajouter le bon plan'}</button>{editing && <button type="button" className="secondary-button" onClick={resetForm}>Annuler</button>}</div>
      </form>
    </section>}

    {!isAdmin && submissions.length > 0 && <section className="my-good-deal-submissions">
      <details><summary>Mes propositions ({submissions.length})</summary><div>{submissions.map((submission) => <p key={submission.id}><strong>{submission.title}</strong> — {submissionTypeLabel(submission.submission_type)} — {submission.status === 'pending' ? 'En attente de validation' : submission.status === 'approved' ? 'Validée' : 'Non retenue'}</p>)}</div></details>
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
          {isAdmin ? <div className="good-deal-admin-actions"><button type="button" onClick={() => beginEdit(deal)}>Modifier</button><button type="button" onClick={() => removeItem(deal)}>Supprimer</button></div> : <div className="good-deal-member-actions"><button type="button" className="deal-suggest-change" onClick={() => startChangeProposal(deal)}>✏ Proposer une modification</button></div>}
        </article>
      })}
    </div>}
  </>
}
