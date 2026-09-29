import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { chargePaidCents, chargeResidualCents, formatMoney } from '../lib/finance.js'
import '../treasury-corrections.css'

const CATEGORY_LABELS = {
  meal: 'Repas', drinks: 'Boissons', activity: 'Activité / sortie',
  adjustment: 'Régularisation', other: 'Autre', membership: 'Cotisation',
}
const day = (value) => value ? new Date(value).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
const cents = (value) => {
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.')
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized) * 100) : NaN
}

export default function TreasuryCorrections({ data, onReload }) {
  const [query, setQuery] = useState('')
  const [eventFilter, setEventFilter] = useState('all')
  const [showCancelled, setShowCancelled] = useState(false)
  const [editingCharge, setEditingCharge] = useState(null)
  const [advanceEditor, setAdvanceEditor] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const events = data.events || []
  const profiles = data.profiles || []
  const offline = data.offline || []
  const members = data.members || []
  const households = data.households || []
  const charges = data.charges || []
  const payments = data.payments || []
  const allocations = data.allocations || []
  const entries = data.entries || []

  const eventById = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e])), [events])
  const profileById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles])
  const offlineById = useMemo(() => Object.fromEntries(offline.map((p) => [p.id, p])), [offline])
  const memberById = useMemo(() => Object.fromEntries(members.map((p) => [p.id, p])), [members])
  const householdById = useMemo(() => Object.fromEntries(households.map((p) => [p.id, p])), [households])

  const chargePerson = (charge) => {
    if (charge.offline_person_id) return offlineById[charge.offline_person_id]?.display_name || 'Personne sans compte'
    if (charge.user_id) return profileById[charge.user_id]?.full_name || profileById[charge.user_id]?.email || 'Membre'
    if (charge.household_member_id) return memberById[charge.household_member_id]?.display_name || 'Membre du foyer'
    return householdById[charge.household_id]?.name || 'Foyer'
  }
  const advancePerson = (entry) => entry.advanced_by_offline
    ? offlineById[entry.advanced_by_offline]?.display_name || 'Personne sans compte'
    : profileById[entry.advanced_by]?.full_name || profileById[entry.advanced_by]?.email || 'Membre'

  const debtRows = charges
    .filter((charge) => charge.category !== 'membership')
    .filter((charge) => showCancelled ? true : charge.status !== 'cancelled')
    .filter((charge) => eventFilter === 'all' || (eventFilter === 'none' ? !charge.event_id : charge.event_id === eventFilter))
    .filter((charge) => {
      const haystack = [charge.label, chargePerson(charge), eventById[charge.event_id]?.title, householdById[charge.household_id]?.name]
        .filter(Boolean).join(' ').toLocaleLowerCase('fr-FR')
      return haystack.includes(query.trim().toLocaleLowerCase('fr-FR'))
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  const advances = entries
    .filter((entry) => entry.kind === 'expense' && entry.payment_method === 'personal_advance' && entry.status !== 'cancelled')
    .sort((a, b) => new Date(b.occurred_at || b.created_at) - new Date(a.occurred_at || a.created_at))

  async function run(key, operation, message) {
    if (busy) return false
    setBusy(key); setError(''); setNotice('')
    try {
      await operation()
      await onReload()
      setNotice(message)
      return true
    } catch (err) {
      setError(err.message || 'La correction n’a pas pu être enregistrée.')
      return false
    } finally {
      setBusy('')
    }
  }

  const openCharge = (charge) => setEditingCharge({
    ...charge,
    editLabel: charge.label,
    editAmount: (Number(charge.amount_cents) / 100).toFixed(2).replace('.', ','),
    editCategory: charge.category,
    editEvent: charge.event_id || '',
  })

  const saveCharge = async (event) => {
    event.preventDefault()
    const amount = cents(editingCharge.editAmount)
    if (!Number.isSafeInteger(amount) || amount <= 0) return setError('Montant invalide.')
    const ok = await run('charge:' + editingCharge.id, async () => {
      const { error: rpcError } = await supabase.rpc('treasury_manage_charge', {
        p_id: editingCharge.id,
        p_action: 'update',
        p_label: editingCharge.editLabel.trim(),
        p_amount_cents: amount,
        p_event_id: editingCharge.editEvent || null,
        p_category: editingCharge.editCategory,
        p_reason: null,
      })
      if (rpcError) throw rpcError
    }, 'Dette corrigée. La modification est conservée dans l’historique d’audit.')
    if (ok) setEditingCharge(null)
  }

  const cancelCharge = async (charge) => {
    const reason = window.prompt('Pourquoi annuler cette dette ? (au moins 5 caractères)', 'Saisie incorrecte')
    if (reason === null) return
    await run('charge:' + charge.id, async () => {
      const { error: rpcError } = await supabase.rpc('treasury_manage_charge', {
        p_id: charge.id, p_action: 'cancel', p_label: charge.label,
        p_amount_cents: Number(charge.amount_cents), p_event_id: charge.event_id || null,
        p_category: charge.category, p_reason: reason.trim(),
      })
      if (rpcError) throw rpcError
    }, 'Dette annulée sans être supprimée. Elle peut être restaurée.')
  }

  const restoreCharge = async (charge) => {
    if (!window.confirm('Restaurer « ' + charge.label + ' » ?')) return
    await run('charge:' + charge.id, async () => {
      const { error: rpcError } = await supabase.rpc('treasury_manage_charge', {
        p_id: charge.id, p_action: 'restore', p_label: charge.label,
        p_amount_cents: Number(charge.amount_cents), p_event_id: charge.event_id || null,
        p_category: charge.category, p_reason: null,
      })
      if (rpcError) throw rpcError
    }, 'Dette restaurée.')
  }

  const openAdvance = (entry) => setAdvanceEditor({
    ...entry,
    editMethod: entry.reimbursement_method || 'bank_transfer',
    editDate: entry.settled_at ? day(entry.settled_at) : day(new Date()),
  })

  const saveAdvance = async (event) => {
    event.preventDefault()
    const ok = await run('advance:' + advanceEditor.id, async () => {
      const { error: rpcError } = await supabase.rpc('treasury_set_advance_reimbursement', {
        p_id: advanceEditor.id, p_reimbursed: true,
        p_method: advanceEditor.editMethod, p_settled_on: advanceEditor.editDate,
      })
      if (rpcError) throw rpcError
    }, advanceEditor.status === 'pending' ? 'Remboursement enregistré.' : 'Remboursement corrigé.')
    if (ok) setAdvanceEditor(null)
  }

  const reopenAdvance = async (entry) => {
    if (!window.confirm('Annuler le marquage « remboursé » ? L’avance repassera en attente.')) return
    await run('advance:' + entry.id, async () => {
      const { error: rpcError } = await supabase.rpc('treasury_set_advance_reimbursement', {
        p_id: entry.id, p_reimbursed: false, p_method: null, p_settled_on: null,
      })
      if (rpcError) throw rpcError
    }, 'Remboursement annulé : l’avance est de nouveau à rembourser.')
  }

  return <section className="tc">
    <header className="tc-head">
      <div><span className="tv2-eyebrow">Corrections simples</span><h2>Modifier sans perdre l’historique</h2>
        <p>Dépenses, dettes et remboursements restent corrigeables. Les annulations sont réversibles et auditées.</p></div>
    </header>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}

    <div className="tc-grid">
      <section className="tc-card">
        <div className="tc-title"><div><h3>Dettes par événement</h3><small>{debtRows.length} ligne{debtRows.length > 1 ? 's' : ''} affichée{debtRows.length > 1 ? 's' : ''}</small></div></div>
        <div className="tc-filters">
          <input type="search" placeholder="Rechercher une personne ou une dette…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
            <option value="all">Tous les événements</option><option value="none">Sans événement</option>
            {events.map((ev) => <option value={ev.id} key={ev.id}>{ev.title}</option>)}
          </select>
          <label><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Voir annulées</label>
        </div>
        <div className="tc-list">
          {debtRows.map((charge) => {
            const paid = chargePaidCents(charge.id, allocations, payments)
            const due = charge.status === 'cancelled' ? 0 : chargeResidualCents(charge, allocations, payments)
            return <article className={'tc-row' + (charge.status === 'cancelled' ? ' cancelled' : '')} key={charge.id}>
              <div className="tc-main"><strong>{chargePerson(charge)}</strong><span>{charge.label}</span>
                <small>{eventById[charge.event_id]?.title || 'Sans événement'} · {CATEGORY_LABELS[charge.category] || charge.category}</small></div>
              <div className="tc-money"><strong>{formatMoney(charge.amount_cents)}</strong><small>{paid ? formatMoney(paid) + ' encaissé · ' : ''}{charge.status === 'cancelled' ? 'annulée' : formatMoney(due) + ' restant'}</small></div>
              <div className="tc-actions">
                {charge.status === 'open' && <button type="button" disabled={Boolean(busy)} onClick={() => openCharge(charge)}>Modifier</button>}
                {charge.status === 'open' && paid === 0 && <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => cancelCharge(charge)}>Annuler</button>}
                {charge.status === 'cancelled' && <button type="button" disabled={Boolean(busy)} onClick={() => restoreCharge(charge)}>Restaurer</button>}
              </div>
            </article>
          })}
          {!debtRows.length && <p className="tv2-empty">Aucune dette pour ce filtre.</p>}
        </div>
      </section>

      <section className="tc-card">
        <div className="tc-title"><div><h3>Avances et remboursements</h3><small>{advances.filter((e) => e.status === 'pending').length} à rembourser</small></div></div>
        <div className="tc-list">
          {advances.map((entry) => <article className="tc-row" key={entry.id}>
            <div className="tc-main"><strong>{advancePerson(entry)}</strong><span>{entry.label}</span>
              <small>{eventById[entry.event_id]?.title || 'Sans événement'} · {entry.status === 'pending' ? 'À rembourser' : 'Remboursé le ' + new Date(entry.settled_at).toLocaleDateString('fr-FR')}</small></div>
            <div className="tc-money"><strong>{formatMoney(entry.amount_cents)}</strong><small>{entry.status === 'settled' ? (entry.reimbursement_method === 'cash' ? 'Caisse espèces' : 'Revolut') : 'En attente'}</small></div>
            <div className="tc-actions">
              <button type="button" disabled={Boolean(busy)} onClick={() => openAdvance(entry)}>{entry.status === 'pending' ? 'Rembourser' : 'Corriger'}</button>
              {entry.status === 'settled' && <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => reopenAdvance(entry)}>Annuler remboursement</button>}
            </div>
          </article>)}
          {!advances.length && <p className="tv2-empty">Aucune avance personnelle.</p>}
        </div>
      </section>
    </div>

    {editingCharge && <div className="tc-backdrop" onClick={() => setEditingCharge(null)} role="presentation">
      <form className="tc-dialog" onSubmit={saveCharge} onClick={(e) => e.stopPropagation()}>
        <header><div><span className="tv2-eyebrow">Correction tracée</span><h3>Modifier la dette</h3></div><button type="button" onClick={() => setEditingCharge(null)} aria-label="Fermer">×</button></header>
        <label>Libellé<input required maxLength={250} value={editingCharge.editLabel} onChange={(e) => setEditingCharge({...editingCharge, editLabel: e.target.value})} /></label>
        <label>Montant (€)<input required inputMode="decimal" value={editingCharge.editAmount} onChange={(e) => setEditingCharge({...editingCharge, editAmount: e.target.value})} /></label>
        <label>Événement<select value={editingCharge.editEvent} onChange={(e) => setEditingCharge({...editingCharge, editEvent: e.target.value})}><option value="">Sans événement</option>{events.map((ev) => <option value={ev.id} key={ev.id}>{ev.title}</option>)}</select></label>
        <label>Catégorie<select value={editingCharge.editCategory} onChange={(e) => setEditingCharge({...editingCharge, editCategory: e.target.value})}>{Object.entries(CATEGORY_LABELS).filter(([key]) => key !== 'membership').map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <footer><button type="button" className="ghost-button" onClick={() => setEditingCharge(null)}>Fermer</button><button className="primary-button" disabled={Boolean(busy)}>Enregistrer la correction</button></footer>
      </form>
    </div>}

    {advanceEditor && <div className="tc-backdrop" onClick={() => setAdvanceEditor(null)} role="presentation">
      <form className="tc-dialog" onSubmit={saveAdvance} onClick={(e) => e.stopPropagation()}>
        <header><div><span className="tv2-eyebrow">Remboursement</span><h3>{advanceEditor.status === 'pending' ? 'Rembourser ' : 'Corriger le remboursement de '}{advancePerson(advanceEditor)}</h3></div><button type="button" onClick={() => setAdvanceEditor(null)} aria-label="Fermer">×</button></header>
        <div className="tc-summary"><span>{advanceEditor.label}</span><strong>{formatMoney(advanceEditor.amount_cents)}</strong></div>
        <label>Compte utilisé<select value={advanceEditor.editMethod} onChange={(e) => setAdvanceEditor({...advanceEditor, editMethod: e.target.value})}><option value="bank_transfer">Revolut</option><option value="cash">Caisse espèces</option></select></label>
        <label>Date du remboursement<input type="date" required max={day(new Date())} value={advanceEditor.editDate} onChange={(e) => setAdvanceEditor({...advanceEditor, editDate: e.target.value})} /></label>
        <footer><button type="button" className="ghost-button" onClick={() => setAdvanceEditor(null)}>Fermer</button><button className="primary-button" disabled={Boolean(busy)}>Enregistrer</button></footer>
      </form>
    </div>}
  </section>
}
