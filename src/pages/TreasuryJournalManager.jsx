import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatMoney } from '../lib/finance.js'
import { accountFor } from '../lib/treasuryLedger.js'
import '../treasury-journal.css'

const categoryLabels = {
  courses: 'Courses / alimentation', materiel: 'Matériel / équipement', evenement: 'Événement',
  transport: 'Transport', frais_bancaires: 'Frais Revolut', fonctionnement: 'Fonctionnement',
  autre: 'Autre dépense', membership: 'Cotisation', don: 'Don', subvention: 'Subvention'
}
const methodLabels = {
  unassigned: 'À répartir', bank_transfer: 'Revolut', card: 'Revolut · carte',
  cash: 'Caisse (liquide)', personal_advance: 'Avance personnelle'
}
const dateText = (value) => value ? new Date(value).toLocaleDateString('fr-FR') : '—'
const day = (value) => value ? new Date(value).toISOString().slice(0, 10) : ''
const cents = (value) => {
  const normalized = String(value ?? '').replace(/\s/g, '').replace(',', '.')
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized) * 100) : NaN
}
const ownerKey = (e) => {
  if (e.payment_method === 'personal_advance')
    return e.advanced_by_offline ? 'offline:' + e.advanced_by_offline : e.advanced_by ? 'user:' + e.advanced_by : ''
  return e.beneficiary_offline_id ? 'offline:' + e.beneficiary_offline_id : e.beneficiary_user_id ? 'user:' + e.beneficiary_user_id : ''
}
const personIds = (key) => ({
  p_user_id: key.startsWith('user:') ? key.slice(5) : null,
  p_offline_id: key.startsWith('offline:') ? key.slice(8) : null
})
const accountLabel = (key) => key === 'cash' ? 'Caisse (liquide)' : 'Revolut'
const transferLabel = (transfer) => accountLabel(transfer.from_account) + ' → ' + accountLabel(transfer.to_account)
const transferArgs = (transfer, action, reason = null) => ({
  p_id: transfer.id, p_action: action,
  p_from_account: transfer.from_account, p_to_account: transfer.to_account,
  p_amount_cents: Number(transfer.amount_cents), p_occurred_on: day(transfer.occurred_at),
  p_note: transfer.note || '', p_reason: reason
})

export default function TreasuryJournalManager({ data, onReload, onReceipt }) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('unassigned')
  const [editing, setEditing] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const entries = data.entries || []
  const transfers = data.transfers || []
  const people = useMemo(() => [
    ...(data.profiles || []).filter((p) => p.active).map((p) => ({ id: 'user:' + p.id, label: p.full_name || p.email, kind: 'Compte' })),
    ...(data.offline || []).filter((p) => !p.linked_user_id).map((p) => ({ id: 'offline:' + p.id, label: p.display_name, kind: 'Sans compte' }))
  ].sort((a, b) => a.label.localeCompare(b.label, 'fr')), [data])
  const peopleById = Object.fromEntries(people.map((p) => [p.id, p]))
  const linkedById = Object.fromEntries((data.offline || []).filter((p) => p.linked_user_id).map((p) =>
    ['offline:' + p.id, { label: (data.profiles || []).find((u) => u.id === p.linked_user_id)?.full_name || p.display_name }]))
  const personName = (entry) => peopleById[ownerKey(entry)]?.label || linkedById[ownerKey(entry)]?.label
    || (entry.household_payment_id ? 'Foyer / cotisation' : 'Sans attribution')
  const allRows = [
    ...entries.map((e) => ({ ...e, recordType: 'entry' })),
    ...transfers.map((t) => ({ ...t, recordType: 'transfer' }))
  ].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)
    || Number(b.source_row || 0) - Number(a.source_row || 0))
  const unassigned = entries.filter((e) => e.payment_method === 'unassigned' && e.status === 'settled')
  const cancelled = entries.filter((e) => e.status === 'cancelled').length
    + transfers.filter((t) => Boolean(t.cancelled_at)).length
  const filtered = allRows.filter((row) => {
    const isTransfer = row.recordType === 'transfer'
    const account = isTransfer ? '' : accountFor(row)
    const cancelledRow = isTransfer ? Boolean(row.cancelled_at) : row.status === 'cancelled'
    const match = mode === 'all'
      || (mode === 'unassigned' && !isTransfer && row.payment_method === 'unassigned' && !cancelledRow)
      || (mode === 'bank' && (isTransfer ? row.from_account === 'bank' || row.to_account === 'bank' : account === 'bank'))
      || (mode === 'cash' && (isTransfer ? row.from_account === 'cash' || row.to_account === 'cash' : account === 'cash'))
      || (mode === 'advances' && !isTransfer && row.payment_method === 'personal_advance')
      || (mode === 'transfers' && isTransfer)
      || (mode === 'cancelled' && cancelledRow)
    const searchText = isTransfer ? transferLabel(row) + ' ' + (row.note || '')
      : row.label + ' ' + (row.note || '') + ' ' + personName(row)
    return match && searchText.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr'))
  })
  const importBatch = data.importBatches?.[0]
  const entryParams = (entry, changes = {}) => ({
    p_id: entry.id, p_label: entry.label, p_note: entry.note || '',
    p_category: entry.category ?? null, p_method: entry.payment_method,
    ...personIds(ownerKey(entry)), p_amount_cents: Number(entry.amount_cents),
    p_occurred_on: day(entry.occurred_at), p_event_id: entry.event_id || null, ...changes
  })
  async function run(key, job, successMessage) {
    if (busy) return false
    setBusy(key); setError(''); setNotice('')
    try {
      await job()
    } catch (e) {
      setError(e.message || 'L’opération a échoué. Aucun changement supplémentaire ne sera effectué.')
      setBusy('')
      return false
    }
    try {
      await onReload()
      setNotice(successMessage)
    } catch (e) {
      setNotice(successMessage + ' Actualisez cette page pour voir les nouveaux soldes.')
    } finally {
      setBusy('')
    }
    return true
  }
  const reclassify = (entry, method) => {
    if (entry.payment_method === method) return
    return run(entry.id, async () => {
      const { error: e } = await supabase.rpc('treasury_update_entry', entryParams(entry, { p_method: method }))
      if (e) throw e
    }, 'Compte mis à jour pour « ' + entry.label + ' ». Les soldes sont recalculés.')
  }
  const open = (row) => {
    setError(''); setNotice('')
    if (row.recordType === 'transfer') {
      setEditing({ ...row, editAmount: (row.amount_cents / 100).toFixed(2).replace('.', ','),
        editFrom: row.from_account, editNote: row.note || '', editDate: day(row.occurred_at) })
    } else {
      setEditing({ ...row, editLabel: row.label, editNote: row.note || '',
        editCategory: row.category || 'autre', editAmount: (row.amount_cents / 100).toFixed(2).replace('.', ','),
        editMethod: row.payment_method, editPerson: ownerKey(row),
        editDate: day(row.occurred_at), editEvent: row.event_id || '' })
    }
  }
  const set = (key, value) => setEditing((old) => ({ ...old, [key]: value }))
  const linked = Boolean(editing?.household_payment_id)
  const advance = editing?.payment_method === 'personal_advance'
  const save = async (event) => {
    event.preventDefault()
    if (!editing) return
    const amount = cents(editing.editAmount)
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000) {
      setError('Montant invalide : valeur positive, deux décimales maximum.')
      return
    }
    if (editing.recordType === 'transfer') {
      const args = { ...transferArgs(editing, 'update'),
        p_from_account: editing.editFrom,
        p_to_account: editing.editFrom === 'cash' ? 'bank' : 'cash',
        p_amount_cents: amount, p_occurred_on: editing.editDate, p_note: editing.editNote }
      const ok = await run(editing.id, async () => {
        const { error: e } = await supabase.rpc('treasury_manage_transfer', args)
        if (e) throw e
      }, 'Transfert Revolut / caisse corrigé ; le total reste inchangé.')
      if (ok) setEditing(null)
      return
    }
    const changes = {
      p_label: editing.editLabel.trim(), p_note: editing.editNote,
      p_category: linked ? editing.category : editing.editCategory,
      p_method: editing.editMethod, p_amount_cents: amount, p_occurred_on: editing.editDate,
      p_event_id: linked ? editing.event_id || null : editing.editEvent || null,
      ...personIds(linked ? ownerKey(editing) : editing.editPerson)
    }
    const ok = await run(editing.id, async () => {
      const { error: e } = await supabase.rpc('treasury_update_entry', entryParams(editing, changes))
      if (e) throw e
    }, 'Écriture corrigée. L’ancienne version reste conservée dans le journal d’audit.')
    if (ok) setEditing(null)
  }
  const askCancel = (row) => {
    setEditing(null); setError(''); setNotice('')
    setCancelling(row); setCancelReason('')
  }
  const cancel = async (event) => {
    event.preventDefault()
    if (!cancelling) return
    const row = cancelling
    if (cancelReason.trim().length < 5) return setError('Expliquez brièvement le motif de l’annulation.')
    const ok = await run('cancel:' + row.id, async () => {
      const response = row.recordType === 'transfer'
        ? await supabase.rpc('treasury_manage_transfer', { ...transferArgs(row, 'cancel', cancelReason.trim()) })
        : await supabase.rpc('treasury_cancel_entry', { p_id: row.id, p_reason: cancelReason.trim() })
      if (response.error) throw response.error
    }, 'Opération annulée. Elle reste dans l’historique et peut être restaurée.')
    if (ok) { setCancelling(null); setCancelReason('') }
  }
  const restore = async (row) => {
    if (!window.confirm('Restaurer « ' + (row.recordType === 'transfer' ? transferLabel(row) : row.label)
      + ' » avec son montant initial et son compte d’origine ?')) return
    await run('restore:' + row.id, async () => {
      const response = row.recordType === 'transfer'
        ? await supabase.rpc('treasury_manage_transfer', transferArgs(row, 'restore'))
        : await supabase.rpc('treasury_restore_entry', { p_id: row.id })
      if (response.error) throw response.error
    }, 'Opération restaurée ; les comptes ont été recalculés.')
  }
  return <section className="tj">
    <header className="tj-header">
      <div><span className="tv2-eyebrow">Journal comptable · Revolut & espèces</span>
        <h2>Chaque entrée et sortie, modifiable</h2>
        <p>Classez les mouvements Excel, corrigez les opérations et gérez les transferts. Les suppressions sont des annulations réversibles et tracées.</p></div>
      <span className="tj-total">{entries.length} écritures · {transfers.length} transferts</span>
    </header>
    {importBatch && <div className="tj-import"><div>
      <strong>Source Excel · {importBatch.exercise} · {formatMoney(importBatch.confirmed_closing_cents)}</strong>
      <span>{importBatch.membership_count} cotisations, répartition Revolut / espèces à effectuer librement.</span>
      <small>Les opérations non affectées ne sont pas attribuées arbitrairement. Le fichier d’origine reste archivé.</small>
    </div><span className="tj-pending">{unassigned.length} à répartir</span></div>}
    {error && <div className="alert error" role="alert">{error}<button type="button" onClick={() => setError('')}>×</button></div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    <div className="tj-filters">
      <input aria-label="Rechercher une opération" type="search" placeholder="Libellé, personne, description…" value={query} onChange={(e) => setQuery(e.target.value)}/>
      <select aria-label="Filtrer le journal" value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="unassigned">À répartir ({unassigned.length})</option>
        <option value="all">Toutes les opérations</option>
        <option value="bank">Revolut</option>
        <option value="cash">Caisse liquide</option>
        <option value="advances">Avances personnelles</option>
        <option value="transfers">Transferts Revolut / espèces</option>
        <option value="cancelled">Annulées ({cancelled})</option>
      </select>
      {mode !== 'all' && <button type="button" className="ghost-button" onClick={() => setMode('all')}>Tout afficher</button>}
    </div>
    <div className="tj-table">
      <div className="tj-row tj-row-head"><span>Date / source</span><span>Opération / personne</span><span>Montant</span><span>Compte</span><span>Actions</span></div>
      {filtered.map((row) => {
        const isTransfer = row.recordType === 'transfer'
        const isCancelled = isTransfer ? Boolean(row.cancelled_at) : row.status === 'cancelled'
        const canAllocate = !isTransfer && !isCancelled && row.status === 'settled' && row.payment_method !== 'personal_advance'
        const name = isTransfer ? transferLabel(row) : row.label
        const canCancel = isTransfer || !row.household_payment_id
        const canRestore = isTransfer ? isCancelled : isCancelled && Boolean(row.cancelled_previous_status)
        return <div className={'tj-row' + (row.payment_method === 'unassigned' ? ' tj-row-pending' : '')
          + (isCancelled ? ' tj-row-cancelled' : '')} key={row.recordType + ':' + row.id}>
          <div className="tj-date">{dateText(row.occurred_at)}
            {row.import_batch_id && <small>Excel · ligne {row.source_row}</small>}
            {row.needs_review && <span className="tj-alert">Date à vérifier</span>}
          </div>
          <div className="tj-description">
            <strong>{isTransfer ? '⇄ ' : row.kind === 'income' ? '＋ ' : '− '}{name}</strong>
            <small>{isTransfer ? row.note || 'Virement interne : aucun impact sur les recettes/dépenses'
              : personName(row) + (row.note ? ' · ' + row.note : '')}</small>
            {isCancelled && <span className="tj-cancel-note">Annulé{row.cancel_reason ? ' : ' + row.cancel_reason : ''}</span>}
            {row.needs_review && row.source_date && <small>Date Excel : {row.source_date}</small>}
          </div>
          <strong className={'tj-amount' + (row.kind === 'income' ? ' incoming' : '')}>
            {isTransfer ? '⇄ ' : row.kind === 'income' ? '+ ' : '− '}{formatMoney(row.amount_cents)}
          </strong>
          <div className="tj-method">{canAllocate
            ? <select aria-label={'Compte de ' + name} value={row.payment_method} disabled={Boolean(busy)}
                onChange={(e) => reclassify(row, e.target.value)}>
                <option value="unassigned">À répartir</option>
                <option value="bank_transfer">Revolut</option>
                <option value="cash">Caisse (liquide)</option>
                {row.payment_method === 'card' && <option value="card">Revolut · carte</option>}
              </select>
            : <span>{isTransfer ? transferLabel(row) : methodLabels[row.payment_method] || row.payment_method}</span>}</div>
          <div className="tj-actions">
            {!isCancelled && <button type="button" disabled={Boolean(busy)} onClick={() => open(row)}>Modifier</button>}
            {!isCancelled && canCancel && <button className="tj-danger" type="button" disabled={Boolean(busy)}
              onClick={() => askCancel(row)}>Annuler</button>}
            {canRestore && <button type="button" disabled={Boolean(busy)} onClick={() => restore(row)}>Restaurer</button>}
            {!isTransfer && row.receipt_storage_path && <button type="button" onClick={() => onReceipt(row)}>Justificatif</button>}
            {!isTransfer && row.household_payment_id && <small className="tj-linked">Cotisation protégée</small>}
          </div>
        </div>
      })}
      {!filtered.length && <div className="tj-empty">Aucune opération pour cette sélection.</div>}
    </div>
    <p className="tv2-hint">Une cotisation encaissée ne peut pas être supprimée depuis le journal : sa correction doit préserver le paiement et le statut du membre. Les avances remboursées restent consultables.</p>
    {Boolean(data.importArchive?.length) && <details className="tj-archive"><summary>Archives de l’ancien bilan · {data.importArchive.length} lignes</summary>
      <p>Les anciens montants sont archivés sans être ajoutés une deuxième fois au report de l’exercice 2026-2027.</p>
      <div className="tj-archive-grid"><strong>Recettes</strong><strong>Dépenses</strong>
        {data.importArchive.map((r) => <div className="tj-archive-pair" key={r.batch_id + ':' + r.source_row}>
          <span>{r.income_label || '—'} <b>{r.income_cents == null ? '' : formatMoney(r.income_cents)}</b></span>
          <span>{r.expense_label || '—'} <b>{r.expense_cents == null ? '' : formatMoney(r.expense_cents)}</b></span>
        </div>)}
      </div>
    </details>}
    {cancelling && <div className="tj-editor-backdrop" role="presentation" onClick={() => setCancelling(null)}>
      <div className="tj-editor tj-cancel-dialog" role="dialog" aria-modal="true"
        aria-label="Annuler une opération" onClick={(e) => e.stopPropagation()}>
        <header><div><span className="tv2-eyebrow">Annulation réversible</span><h2>Annuler cette opération ?</h2>
          <small>{cancelling.recordType === 'transfer' ? transferLabel(cancelling) : cancelling.label} · {formatMoney(cancelling.amount_cents)}</small></div>
          <button type="button" aria-label="Fermer" onClick={() => setCancelling(null)}>×</button></header>
        <p>L’opération ne sera plus prise en compte dans les soldes, mais restera dans le journal d’audit et pourra être restaurée.</p>
        <form onSubmit={cancel}>
          <label>Motif obligatoire<textarea required minLength={5} maxLength={500} rows={3}
            value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Ex. Saisie en double, montant saisi par erreur…" /></label>
          <footer><button type="button" className="ghost-button" onClick={() => setCancelling(null)}>Conserver</button>
            <button type="submit" className="tj-confirm-cancel" disabled={Boolean(busy) || cancelReason.trim().length < 5}>
              {busy ? 'Annulation…' : 'Confirmer l’annulation'}</button></footer>
        </form>
      </div>
    </div>}
    {editing && <div className="tj-editor-backdrop" role="presentation" onClick={() => setEditing(null)}>
      <div className="tj-editor" role="dialog" aria-modal="true"
        aria-label={editing.recordType === 'transfer' ? 'Modifier un transfert' : 'Modifier une écriture'}
        onClick={(e) => e.stopPropagation()}>
        <header><div><span className="tv2-eyebrow">Correction tracée</span>
          <h2>{editing.recordType === 'transfer' ? 'Modifier le transfert' : 'Modifier une écriture'}</h2>
          <small>{editing.import_batch_id ? 'Excel · ligne ' + editing.source_row : 'Écriture du site'}</small></div>
          <button type="button" aria-label="Fermer" onClick={() => setEditing(null)}>×</button></header>
        <form onSubmit={save}>
          {editing.recordType === 'transfer' ? <>
            <label>Compte de départ<select value={editing.editFrom} onChange={(e) => set('editFrom', e.target.value)}>
              <option value="bank">Revolut → Caisse (liquide)</option>
              <option value="cash">Caisse (liquide) → Revolut</option>
            </select></label>
            <label>Motif du transfert<textarea rows={2} maxLength={1000} value={editing.editNote}
              onChange={(e) => set('editNote', e.target.value)}/></label>
          </> : <>
            <label>Libellé<input autoFocus required maxLength={250} value={editing.editLabel}
              onChange={(e) => set('editLabel', e.target.value)}/></label>
            <label>Description détaillée<textarea rows={3} value={editing.editNote}
              onChange={(e) => set('editNote', e.target.value)}/></label>
          </>}
          <div className="tj-editor-grid">
            <label>Montant (€)<input inputMode="decimal" required disabled={linked} value={editing.editAmount}
              onChange={(e) => set('editAmount', e.target.value)}/></label>
            <label>Date de l’opération<input type="date" required max={new Date().toISOString().slice(0,10)}
              value={editing.editDate} onChange={(e) => set('editDate', e.target.value)}/></label>
          </div>
          {editing.recordType === 'transfer' && <p className="tv2-hint">Un transfert change les deux soldes, jamais le résultat de l’Amicale.</p>}
          {editing.recordType !== 'transfer' && <>
            <div className="tj-editor-grid">
              <label>Catégorie<select value={editing.editCategory} disabled={linked}
                onChange={(e) => set('editCategory', e.target.value)}>
                {[...new Set([editing.editCategory, ...Object.keys(categoryLabels)])].map((key) =>
                  <option value={key} key={key}>{categoryLabels[key] || key}</option>)}
              </select></label>
              <label>Compte<select disabled={advance} value={editing.editMethod}
                onChange={(e) => set('editMethod', e.target.value)}>
                {advance ? <option value="personal_advance">Avance personnelle</option> : <>
                  <option value="unassigned">À répartir</option><option value="bank_transfer">Revolut</option>
                  <option value="cash">Caisse (liquide)</option>
                  {editing.editMethod === 'card' && <option value="card">Revolut · carte</option>}
                </>}
              </select></label>
            </div>
            <label>{advance ? 'Personne ayant avancé' : 'Personne bénéficiaire / à qui attribuer'}
              <select disabled={linked} value={editing.editPerson} onChange={(e) => set('editPerson', e.target.value)}>
                <option value="">Sans attribution individuelle</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.kind}</option>)}
              </select>
            </label>
            {linked && <p className="tv2-hint">Cotisation encaissée : montant et bénéficiaire protégés. Le compte, la date et le libellé restent modifiables.</p>}
            <label>Événement<select disabled={linked} value={editing.editEvent}
              onChange={(e) => set('editEvent', e.target.value)}>
              <option value="">Sans événement</option>
              {(data.events || []).map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
            </select></label>
            {editing.needs_review && <p className="tj-alert">Date d’origine du fichier : {editing.source_date}. Vérifiez-la avant correction.</p>}
          </>}
          <footer><button type="button" className="ghost-button" onClick={() => setEditing(null)}>Annuler</button>
            <button type="submit" className="primary-button" disabled={Boolean(busy)}>
              {busy ? 'Enregistrement…' : 'Enregistrer les corrections'}</button></footer>
        </form>
      </div>
    </div>}
  </section>
}
