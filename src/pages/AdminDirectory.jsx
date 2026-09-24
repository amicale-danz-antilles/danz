import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { effectiveAmicaliste } from '../lib/finance.js'
import '../admin-directory.css'

const dateLabel = (value) => value ? new Date(value + 'T12:00:00').toLocaleDateString('fr-FR') : '—'
const clean = (value) => String(value || '').trim().toLocaleLowerCase('fr-FR')

export default function AdminDirectory() {
  const { isAdmin, loading: authLoading } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [requests, setRequests] = useState([])
  const [offline, setOffline] = useState([])
  const [members, setMembers] = useState([])
  const [households, setHouseholds] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newPerson, setNewPerson] = useState({ name: '', email: '', notes: '' })
  const [selected, setSelected] = useState(null)
  const [offlineDraft, setOfflineDraft] = useState(null)
  const [linkedProfileId, setLinkedProfileId] = useState('')

  const load = async () => {
    const results = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('membership_requests').select('id,auth_user_id,full_name,email,applicant_type,military_reference,status,created_at').order('created_at', { ascending: false }),
      supabase.from('offline_people').select('*').order('display_name'),
      supabase.from('household_members').select('household_id,user_id'),
      supabase.from('households').select('id,name'),
    ])
    const problem = results.find((row) => row.error)
    if (problem) throw problem.error
    setProfiles(results[0].data || [])
    setRequests(results[1].data || [])
    setOffline(results[2].data || [])
    setMembers(results[3].data || [])
    setHouseholds(results[4].data || [])
    if (selected) {
      const current = (results[2].data || []).find((person) => person.id === selected.id)
      setSelected(current && !current.linked_user_id ? current : null)
      if (current && !current.linked_user_id) setOfflineDraft({ display_name: current.display_name, email: current.email || '', notes: current.notes || '', is_amicaliste: current.is_amicaliste, membership_valid_until: current.membership_valid_until || '' })
    }
  }
  useEffect(() => {
    if (!isAdmin) { if (!authLoading) setLoading(false); return }
    let active = true
    load().catch((e) => { if (active) setError(e.message || 'Impossible de charger les membres.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isAdmin, authLoading])
  if (!authLoading && !isAdmin) return <Navigate to="/" replace />

  const householdOf = Object.fromEntries(members.filter((m) => m.user_id).map((m) => [m.user_id, m.household_id]))
  const householdNames = Object.fromEntries(households.map((h) => [h.id, h.name]))
  const pending = requests.filter((r) => r.status === 'pending')
  const registered = profiles.filter((p) => p.active)
  const inactive = profiles.filter((p) => !p.active)
  const notRegistered = offline.filter((p) => !p.linked_user_id)
  const archived = requests.filter((r) => r.status === 'rejected')
  const linkedIds = new Set(offline.map((p) => p.linked_user_id).filter(Boolean))

  const rows = [
    ...pending.map((r) => ({ id: r.id, type: 'request', name: r.full_name, email: r.email, source: r })),
    ...registered.map((p) => ({ id: p.id, type: 'account', name: p.full_name || p.email, email: p.email, source: p })),
    ...notRegistered.map((p) => ({ id: p.id, type: 'offline', name: p.display_name, email: p.email, source: p })),
    ...inactive.map((p) => ({ id: p.id, type: 'inactive', name: p.full_name || p.email, email: p.email, source: p })),
  ].filter((row) => (tab === 'all' || tab === row.type) && (clean(row.name + ' ' + (row.email || ''))).includes(clean(query)))

  const perform = async (run, success) => {
    setBusy(true); setError(''); setNotice('')
    try {
      await run()
      await load()
      setNotice(success)
    } catch (e) {
      setError(e.message || 'Action impossible.')
    } finally { setBusy(false) }
  }

  const decide = (request, decision) => {
    if (decision === 'reject' && !window.confirm('Refuser la demande de ' + request.full_name + ' ?')) return
    perform(async () => {
      const { data, error: callError } = await supabase.functions.invoke('approve-membership-request', { body: { requestId: request.id, action: decision } })
      if (callError || data?.error) throw new Error(data?.error || callError.message)
    }, decision === 'approve' ? 'Compte approuvé. Si la personne possédait une fiche sans compte, rapprochez les deux dossiers manuellement.' : 'Demande refusée.')
  }

  const createPerson = (event) => {
    event.preventDefault()
    if (!newPerson.name.trim()) return
    perform(async () => {
      const { error: rpcError } = await supabase.rpc('admin_create_offline_person', { p_name: newPerson.name.trim(), p_email: newPerson.email.trim() || null, p_notes: newPerson.notes.trim() || null })
      if (rpcError) throw rpcError
      setCreating(false)
      setNewPerson({ name: '', email: '', notes: '' })
    }, 'Fiche créée. Ses dettes peuvent désormais être suivies en trésorerie.')
  }

  const openPerson = (person) => {
    setSelected(person)
    setLinkedProfileId('')
    setOfflineDraft({ display_name: person.display_name, email: person.email || '', notes: person.notes || '', is_amicaliste: person.is_amicaliste, membership_valid_until: person.membership_valid_until || '' })
    setError(''); setNotice('')
  }
  const savePerson = (event) => {
    event.preventDefault()
    if (!selected || !offlineDraft) return
    if (offlineDraft.is_amicaliste && !offlineDraft.membership_valid_until) return setError('Précisez la date de validité de la cotisation.')
    perform(async () => {
      const { error: updateError } = await supabase.from('offline_people').update({
        display_name: offlineDraft.display_name.trim(),
        email: offlineDraft.email.trim().toLowerCase() || null,
        notes: offlineDraft.notes.trim() || null,
        is_amicaliste: offlineDraft.is_amicaliste,
        membership_valid_until: offlineDraft.is_amicaliste ? offlineDraft.membership_valid_until : null,
        updated_at: new Date().toISOString(),
      }).eq('id', selected.id)
      if (updateError) throw updateError
    }, 'Fiche mise à jour.')
  }
  const linkAccount = () => {
    if (!selected || !linkedProfileId) return
    const profile = profiles.find((p) => p.id === linkedProfileId)
    if (!profile || !window.confirm('Associer « ' + selected.display_name + ' » au compte « ' + (profile.full_name || profile.email) + ' » ? Les dettes, règlements et éventuels membres des foyers seront réunis. Vérifiez soigneusement l’identité.')) return
    perform(async () => {
      const { error: linkError } = await supabase.rpc('admin_link_offline_person', { p_person_id: selected.id, p_user_id: linkedProfileId })
      if (linkError) throw linkError
      setSelected(null); setOfflineDraft(null); setLinkedProfileId('')
    }, 'Fiche associée au compte. Les opérations du foyer provisoire sont conservées.')
  }

  const candidates = profiles.filter((p) => p.active && !linkedIds.has(p.id)).sort((a, b) => {
    const match = (p) => selected?.email && clean(p.email) === clean(selected.email) ? -1 : 0
    return match(a) - match(b) || clean(a.full_name).localeCompare(clean(b.full_name), 'fr')
  })
  const duplicate = newPerson.email.trim() && (profiles.some((p) => clean(p.email) === clean(newPerson.email)) || offline.some((p) => clean(p.email) === clean(newPerson.email)))

  return <div className="directory-page">
    <header className="directory-top"><div><span className="eyebrow">Administration</span><h1>Membres & accès</h1><p>Demandes, comptes actifs et personnes sans compte, au même endroit.</p></div><button className="primary-button" type="button" onClick={() => setCreating((value) => !value)}>＋ Ajouter sans compte</button></header>
    <div className="directory-stats">
      <button type="button" className="directory-stat" onClick={() => setTab('request')}><strong>{pending.length}</strong><span>Demandes à traiter</span></button>
      <button type="button" className="directory-stat" onClick={() => setTab('account')}><strong>{registered.length}</strong><span>Comptes actifs</span></button>
      <button type="button" className="directory-stat" onClick={() => setTab('offline')}><strong>{notRegistered.length}</strong><span>Personnes sans compte</span></button>
      <button type="button" className="directory-stat" onClick={() => setTab('inactive')}><strong>{inactive.length}</strong><span>Comptes suspendus</span></button>
    </div>
    {error && <div className="alert error" role="alert">{error}<button type="button" onClick={() => setError('')}>×</button></div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {creating && <section className="directory-form-panel"><div><h2>Nouvelle personne sans compte</h2><p>Une fiche de suivi, pas un accès au site. Ses opérations pourront être rattachées à son futur compte après vérification.</p></div>
      <form onSubmit={createPerson} className="directory-add-form"><label>Nom complet<input required maxLength={160} autoFocus value={newPerson.name} onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })} /></label><label>E-mail (facultatif)<input type="email" value={newPerson.email} onChange={(e) => setNewPerson({ ...newPerson, email: e.target.value })} /></label><label>Note (facultatif)<input maxLength={500} value={newPerson.notes} onChange={(e) => setNewPerson({ ...newPerson, notes: e.target.value })} /></label>
        {duplicate && <p className="directory-duplicate">Une personne utilise déjà cet e-mail. Vérifiez avant de créer une deuxième fiche.</p>}
        <div className="directory-actions"><button type="submit" className="primary-button" disabled={busy}>Créer la fiche</button><button type="button" className="ghost-button" onClick={() => setCreating(false)}>Annuler</button></div></form>
    </section>}
    <section className="directory-panel"><div className="directory-toolbar"><div className="directory-tabs" role="group" aria-label="Filtrer les membres">
      {[['all', 'Tout', pending.length + registered.length + notRegistered.length + inactive.length], ['request', 'En attente', pending.length], ['account', 'Comptes', registered.length], ['offline', 'Sans compte', notRegistered.length], ['inactive', 'Suspendus', inactive.length]].map(([value, label, count]) => <button type="button" className={tab === value ? 'active' : ''} aria-pressed={tab === value} key={value} onClick={() => setTab(value)}>{label} <span>{count}</span></button>)}
    </div><input type="search" aria-label="Rechercher dans les membres" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un nom ou e-mail…" /></div>
      <div className="directory-list-head" aria-hidden="true"><span>Personne</span><span>Situation</span><span>Cotisation</span><span>Action</span></div>
      {loading ? <div className="skeleton-card" /> : rows.length === 0 ? <p className="directory-empty">{query ? 'Aucun résultat pour cette recherche.' : 'Aucune personne dans cette catégorie.'}</p> : <div className="directory-list">{rows.map((row) => {
        const p = row.source
        const isMember = row.type === 'account' || row.type === 'inactive' ? effectiveAmicaliste(p) : row.type === 'offline' && p.is_amicaliste && p.membership_valid_until && p.membership_valid_until >= new Date().toISOString().slice(0, 10)
        const status = row.type === 'request' ? 'Demande en attente' : row.type === 'offline' ? 'Sans compte' : row.type === 'inactive' ? 'Suspendu' : 'Compte actif'
        return <div className={'directory-row directory-' + row.type} key={row.type + row.id}><div className="directory-identity"><span className="directory-avatar">{(row.name || '?').slice(0, 1).toUpperCase()}</span><div><strong>{row.name || 'Non renseigné'}</strong><small>{row.email || 'E-mail non communiqué'}{row.type === 'account' ? ' · ' + (householdNames[householdOf[p.id]] || 'Sans foyer') : ''}</small></div></div><div><span className={'directory-status status-' + row.type}>{status}</span>{p.is_treasurer && <small>Trésorier</small>}</div><div>{row.type === 'request' ? <small>Après validation</small> : <span className={'directory-status ' + (isMember ? 'member-ok' : 'member-no')}>{isMember ? 'À jour' : 'Non-amicaliste'}</span>}</div><div className="directory-row-actions">{row.type === 'request' ? <><button type="button" className="directory-accept" disabled={busy} onClick={() => decide(p, 'approve')}>Approuver</button><button type="button" disabled={busy} onClick={() => decide(p, 'reject')}>Refuser</button></> : row.type === 'offline' ? <button type="button" onClick={() => openPerson(p)}>Dossier</button> : <Link to={'/administration/utilisateurs/gestion?compte=' + encodeURIComponent(p.id)}>Gérer</Link>}</div></div>
      })}</div>}
      <div className="directory-list-foot">{rows.length} personne{rows.length > 1 ? 's' : ''} affichée{rows.length > 1 ? 's' : ''}. <Link to="/administration/utilisateurs/gestion">Gestion détaillée des comptes & foyers →</Link></div>
    </section>
    {archived.length > 0 && <details className="directory-history"><summary>{archived.length} ancienne{archived.length > 1 ? 's' : ''} demande{archived.length > 1 ? 's' : ''} refusée{archived.length > 1 ? 's' : ''}</summary>{archived.map((r) => <p key={r.id}>{r.full_name} · {r.email} · {new Date(r.created_at).toLocaleDateString('fr-FR')}</p>)}</details>}
    {selected && offlineDraft && <div className="directory-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null) }}><aside className="directory-drawer" role="dialog" aria-modal="true" aria-label={'Fiche de ' + selected.display_name}>
      <div className="directory-drawer-head"><div><span className="eyebrow">Personne sans compte</span><h2>{selected.display_name}</h2><p>Cette fiche conserve les mouvements du foyer avant la création d’un compte.</p></div><button type="button" aria-label="Fermer" onClick={() => setSelected(null)}>×</button></div>
      <form className="directory-drawer-form" onSubmit={savePerson}><label>Nom<input required maxLength={160} value={offlineDraft.display_name} onChange={(e) => setOfflineDraft({ ...offlineDraft, display_name: e.target.value })} /></label><label>E-mail<input type="email" value={offlineDraft.email} onChange={(e) => setOfflineDraft({ ...offlineDraft, email: e.target.value })} /></label><label>Notes<textarea rows={2} value={offlineDraft.notes} onChange={(e) => setOfflineDraft({ ...offlineDraft, notes: e.target.value })} /></label><label className="directory-check"><input type="checkbox" checked={offlineDraft.is_amicaliste} onChange={(e) => setOfflineDraft({ ...offlineDraft, is_amicaliste: e.target.checked })} /> Cotisation acquittée / amicaliste</label>{offlineDraft.is_amicaliste && <label>Valable jusqu’au<input type="date" required value={offlineDraft.membership_valid_until} onChange={(e) => setOfflineDraft({ ...offlineDraft, membership_valid_until: e.target.value })} /></label>}<button className="primary-button" disabled={busy}>Enregistrer la fiche</button></form>
      <div className="directory-link"><h3>Associer à un compte créé ultérieurement</h3><p>Aucune association automatique par e-mail : choisissez le compte après avoir vérifié qu’il s’agit bien de la même personne. Les dettes et encaissements sont conservés.</p><select value={linkedProfileId} onChange={(e) => setLinkedProfileId(e.target.value)} aria-label="Compte à associer"><option value="">Sélectionner le compte actif…</option>{candidates.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email} · {p.email}{selected.email && clean(selected.email) === clean(p.email) ? ' · e-mail correspondant' : ''}</option>)}</select><button className="ghost-button" disabled={!linkedProfileId || busy} type="button" onClick={linkAccount}>Associer et réunir les foyers</button></div>
      <Link className="directory-finance-link" to="/administration/tresorerie">Consulter les dettes dans la trésorerie →</Link>
    </aside></div>}
  </div>
}
