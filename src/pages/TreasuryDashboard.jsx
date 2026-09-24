import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { chargeResidualCents, effectiveAmicaliste, formatMoney, householdBalanceCents } from '../lib/finance.js'
import { optimizeImageFile } from '../lib/mediaStorage.js'
import { accountFor, accountingDate, ledgerBalances, signedCents } from '../lib/treasuryLedger.js'

const EXPENSE_CATEGORIES = {
  courses: 'Courses & alimentation', evenement: 'Événement & réception', materiel: 'Matériel',
  transport: 'Transport', frais_bancaires: 'Frais bancaires', fonctionnement: 'Fonctionnement', autre: 'Autre dépense',
}
const INCOME_CATEGORIES = { don: 'Don', subvention: 'Subvention', evenement: 'Recette d’événement', autre: 'Autre recette' }
const METHOD_NAMES = { cash: 'Espèces', card: 'Carte bancaire', bank_transfer: 'Virement bancaire', personal_advance: 'Avance personnelle' }
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const localDay = () => {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}
const centsOf = (value) => {
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.')
  return /^-?\d+(\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized) * 100) : NaN
}
const timeOf = (date) => {
  if (!date || date > localDay()) throw new Error('Sélectionnez une date au plus tard aujourd’hui.')
  return date === localDay() ? new Date().toISOString() : new Date(date + 'T12:00:00').toISOString()
}
const formattedDate = (value) => value ? new Date(value).toLocaleDateString('fr-FR') : '—'
const csvCell = (value) => {
  let text = String(value ?? '')
  if (/^\s*[=+@-]/.test(text)) text = "'" + text
  return '"' + text.replace(/"/g, '""') + '"'
}
const csvDownload = (name, rows) => {
  const csv = '\ufeff' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
const fetchAll = async (table, orderField = 'created_at') => {
  const result = []
  let start = 0
  while (true) {
    const { data, error } = await supabase.from(table).select('*').order(orderField, { ascending: false }).range(start, start + 499)
    if (error) throw error
    result.push(...(data || []))
    if (!data || data.length < 500) return result
    start += 500
  }
}
const defaultEntry = () => ({ kind: 'expense', label: '', amount: '', category: 'courses', payment_method: 'card', advanced_by: '', event_id: '', note: '', date: localDay() })

export default function TreasuryDashboard({ view, onAdvanced, onView }) {
  const { user } = useTreasuryIdentity()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [formType, setFormType] = useState('')
  const [entryForm, setEntryForm] = useState(defaultEntry)
  const [transferForm, setTransferForm] = useState({ from_account: 'bank', amount: '', note: '', date: localDay() })
  const [openingDraft, setOpeningDraft] = useState({ bank: '', cash: '' })
  const [receipt, setReceipt] = useState(null)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [accountFilter, setAccountFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [memberFilter, setMemberFilter] = useState('')
  const [reimburseBy, setReimburseBy] = useState({})
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [chargeDraft, setChargeDraft] = useState({ label: '', amount: '', category: 'other', event_id: '' })
  const [exporting, setExporting] = useState(false)

  async function reload() {
    const [entries, transfers, households, members, profiles, charges, payments, allocations, subscriptions, events, offline, openingResult, settingsResult] = await Promise.all([
      fetchAll('treasury_entries', 'occurred_at'),
      fetchAll('treasury_transfers', 'occurred_at'),
      fetchAll('households', 'name'),
      fetchAll('household_members', 'display_name'),
      fetchAll('profiles', 'full_name'),
      fetchAll('household_charges'),
      fetchAll('household_payments'),
      fetchAll('household_payment_allocations', 'payment_id'),
      fetchAll('membership_subscriptions'),
      fetchAll('events', 'starts_at'),
      fetchAll('offline_people', 'display_name'),
      supabase.from('treasury_opening').select('*').eq('id', 1).maybeSingle(),
      supabase.from('association_settings').select('*').eq('id', 1).single(),
    ])
    if (openingResult.error) throw openingResult.error
    if (settingsResult.error) throw settingsResult.error
    setData({ entries, transfers, households, members, profiles, charges, payments, allocations, subscriptions, events, offline, opening: openingResult.data, settings: settingsResult.data })
    setOpeningDraft({ bank: openingResult.data ? String(openingResult.data.bank_cents / 100) : '', cash: openingResult.data ? String(openingResult.data.cash_cents / 100) : '' })
  }

  useEffect(() => {
    let active = true
    reload().catch((e) => { if (active) setError(e.message || 'Impossible de charger la trésorerie.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function action(operation, message) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await operation()
      await reload()
      setNotice(message)
    } catch (e) {
      setError(e.message || 'L’opération n’a pas été enregistrée.')
    } finally { setBusy(false) }
  }

  const entries = data?.entries || []
  const transfers = data?.transfers || []
  const households = data?.households || []
  const profiles = data?.profiles || []
  const offline = data?.offline || []
  const householdMembers = data?.members || []
  const charges = data?.charges || []
  const payments = data?.payments || []
  const allocations = data?.allocations || []
  const opening = data?.opening
  const profileById = useMemo(() => Object.fromEntries((data?.profiles || []).map((p) => [p.id, p])), [data])
  const householdById = useMemo(() => Object.fromEntries((data?.households || []).map((h) => [h.id, h])), [data])
  const offlineById = useMemo(() => Object.fromEntries((data?.offline || []).map((p) => [p.id, p])), [data])
  const pendingPayments = payments.filter((p) => p.status === 'declared')
  const pendingAdvances = entries.filter((e) => e.payment_method === 'personal_advance' && e.status === 'pending')
  const dueByHousehold = useMemo(() => Object.fromEntries(households.map((h) => [
    h.id, householdBalanceCents(charges.filter((c) => c.household_id === h.id), allocations, payments),
  ])), [households, charges, allocations, payments])
  const dueTotal = Object.values(dueByHousehold).reduce((sum, amount) => sum + amount, 0)
  const dues = charges.filter((c) => c.category === 'membership' && c.status !== 'cancelled')
    .reduce((sum, c) => sum + chargeResidualCents(c, allocations, payments), 0)
  const pendingAdvanceCents = pendingAdvances.reduce((s, e) => s + Number(e.amount_cents), 0)
  const cleared = entries.filter((e) => e.status === 'settled')
  const balances = ledgerBalances(opening, entries, transfers) || { bank: 0, cash: 0 }

  const activity = [
    ...entries.map((e) => ({ ...e, type: 'entry', date: accountingDate(e), account: accountFor(e), signed: e.status === 'pending' || e.status === 'cancelled' ? 0 : signedCents(e) })),
    ...transfers.map((t) => ({ ...t, type: 'transfer', date: t.occurred_at, account: t.from_account, signed: 0, label: 'Virement interne · ' + (t.from_account === 'bank' ? 'Banque → Espèces' : 'Espèces → Banque') })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))
  const activityFiltered = activity.filter((e) => {
    const text = (e.label + ' ' + (e.note || '')).toLocaleLowerCase('fr-FR')
    const month = e.date ? new Date(e.date).getFullYear() + '-' + String(new Date(e.date).getMonth() + 1).padStart(2, '0') : ''
    return (kindFilter === 'all' || (kindFilter === 'transfer' ? e.type === 'transfer' : e.type === 'entry' && e.kind === kindFilter))
      && (accountFilter === 'all' || (e.type === 'transfer' ? true : e.account === accountFilter))
      && (monthFilter === 'all' || month === monthFilter)
      && text.includes(query.trim().toLocaleLowerCase('fr-FR'))
  })
  const year = new Date().getFullYear()
  const monthly = MONTHS.map((label, i) => {
    const matching = cleared.filter((e) => { const d = new Date(accountingDate(e)); return d.getFullYear() === year && d.getMonth() === i })
    return { label, income: matching.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amount_cents, 0),
      expense: matching.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount_cents, 0) }
  })
  const monthNow = monthly[new Date().getMonth()]
  const maxMonth = Math.max(1, ...monthly.flatMap((m) => [m.income, m.expense]))
  const memberships = profiles.filter((p) => p.active === true && (p.full_name || p.email || '').toLocaleLowerCase('fr-FR').includes(memberFilter.toLocaleLowerCase('fr-FR')))
    .sort((a, b) => {
      const aDate = a.membership_valid_until || '0000-00-00'
      const bDate = b.membership_valid_until || '0000-00-00'
      return aDate.localeCompare(bDate)
    })
  const currentMemberCount = profiles.filter((p) => p.active && effectiveAmicaliste(p)).length + offline.filter((p) => !p.linked_user_id && p.is_amicaliste && p.membership_valid_until >= localDay()).length
  const expiringCount = profiles.filter((p) => p.active && effectiveAmicaliste(p) && p.membership_valid_until && new Date(p.membership_valid_until + 'T23:59:59').getTime() < Date.now() + 60 * 86400000).length + offline.filter((p) => !p.linked_user_id && p.is_amicaliste && p.membership_valid_until >= localDay() && new Date(p.membership_valid_until + 'T23:59:59').getTime() < Date.now() + 60 * 86400000).length


  const roster = [
    ...profiles.filter((p) => p.active).map((p) => ({ ...p, personType: 'account', personId: p.id, display: p.full_name || p.email, household_id: householdMembers.find((m) => m.user_id === p.id)?.household_id })),
    ...offline.filter((p) => !p.linked_user_id).map((p) => ({ ...p, personType: 'offline', personId: p.id, display: p.display_name })),
  ].filter((p) => (p.display + ' ' + (p.email || '')).toLocaleLowerCase('fr-FR').includes(memberFilter.toLocaleLowerCase('fr-FR')))
   .sort((a,b) => a.display.localeCompare(b.display, 'fr'))
  const selectedMember = roster.find((p) => p.personType + ':' + p.personId === selectedPerson)
  const relatedCharges = selectedMember ? charges.filter((c) => c.status === 'open' && c.household_id === selectedMember.household_id && (
    selectedMember.personType === 'offline' ? c.offline_person_id === selectedMember.id
      : c.user_id === selectedMember.id || (c.offline_person_id && offlineById[c.offline_person_id]?.linked_user_id === selectedMember.id) || householdMembers.some((m) => m.id === c.household_member_id && m.user_id === selectedMember.id)
  )) : []
  const relatedAdvances = selectedMember ? entries.filter((e) => e.payment_method === 'personal_advance' && e.status === 'pending' && (selectedMember.personType === 'offline' ? e.advanced_by_offline === selectedMember.id : e.advanced_by === selectedMember.id || (e.advanced_by_offline && offlineById[e.advanced_by_offline]?.linked_user_id === selectedMember.id))) : []
  const memberChargeDue = relatedCharges.reduce((s,c) => s + chargeResidualCents(c, allocations, payments), 0)
  const addDirectCharge = (event) => {
    event.preventDefault()
    if (!selectedMember?.household_id) return setError('Cette personne n’a pas encore de foyer associé.')
    const amount = centsOf(chargeDraft.amount)
    if (!Number.isSafeInteger(amount) || amount <= 0 || !chargeDraft.label.trim()) return setError('Complétez le libellé et un montant positif.')
    action(async () => {
      const { error: e } = await supabase.from('household_charges').insert({
        household_id: selectedMember.household_id,
        offline_person_id: selectedMember.personType === 'offline' ? selectedMember.id : null,
        user_id: selectedMember.personType === 'account' ? selectedMember.id : null,
        category: chargeDraft.category, label: chargeDraft.label.trim(), amount_cents: amount,
        event_id: chargeDraft.event_id || null, created_by: user.id,
      })
      if (e) throw e
      setChargeDraft({ label: '', amount: '', category: 'other', event_id: '' })
    }, 'Dette ajoutée à ' + selectedMember.display + '.')
  }
  const cancelDirectCharge = (charge) => {
    if (!window.confirm('Annuler cette dette ? L’écriture restera dans l’historique.')) return
    action(async () => {
      const { error: e } = await supabase.from('household_charges').update({ status: 'cancelled', cancelled_by: user.id, cancelled_at: new Date().toISOString() }).eq('id', charge.id)
      if (e) throw e
    }, 'Dette annulée, historique conservé.')
  }
  const collectDirect = (method) => {
    if (!selectedMember?.household_id || !relatedCharges.length || memberChargeDue <= 0) return
    if (!window.confirm('Enregistrer ' + formatMoney(memberChargeDue) + ' reçu de ' + selectedMember.display + ' sur ' + (method === 'cash' ? 'la caisse (liquide)' : 'le compte bancaire') + ' ?')) return
    action(async () => {
      const { error: e } = await supabase.rpc('admin_record_household_payment', {
        p_household_id: selectedMember.household_id,
        p_charge_ids: relatedCharges.filter((c) => chargeResidualCents(c, allocations, payments) > 0).map((c) => c.id),
        p_method: method, p_note: 'Règlement nominatif ' + selectedMember.display,
      })
      if (e) throw e
    }, 'Règlement personnel enregistré et dettes rapprochées.')
  }

  const submitEntry = async (event) => {
    event.preventDefault()
    const amount = centsOf(entryForm.amount)
    if (!entryForm.label.trim() || !Number.isSafeInteger(amount) || amount <= 0) return setError('Indiquez un libellé et un montant positif valide (deux décimales maximum).')
    if (entryForm.payment_method === 'personal_advance' && !entryForm.advanced_by) return setError('Sélectionnez le membre qui a avancé la dépense.')
    await action(async () => {
      const deferred = entryForm.payment_method === 'personal_advance'
      const offlineAdvance = deferred && entryForm.advanced_by.startsWith('offline:')
      const payload = {
        kind: entryForm.kind, amount_cents: amount, label: entryForm.label.trim(), category: entryForm.category,
        payment_method: entryForm.payment_method, advanced_by: deferred && !offlineAdvance ? entryForm.advanced_by : null,
        advanced_by_offline: offlineAdvance ? entryForm.advanced_by.slice(8) : null,
        event_id: entryForm.event_id || null, note: entryForm.note.trim() || null, occurred_at: timeOf(entryForm.date),
        status: deferred ? 'pending' : 'settled', created_by: user.id,
        settled_by: deferred ? null : user.id, settled_at: deferred ? null : new Date().toISOString(),
      }
      const { data: saved, error: insertError } = await supabase.from('treasury_entries').insert(payload).select('*').single()
      if (insertError) throw insertError
      if (receipt) {
        try {
          const file = receipt.type.startsWith('image/') ? await optimizeImageFile(receipt, { maxDimension: 1600, quality: 0.8 }) : receipt
          const path = 'treasury/' + saved.id + '/' + Date.now() + '-' + file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-')
          const { error: uploadError } = await supabase.storage.from('content').upload(path, file, { contentType: file.type || undefined })
          if (uploadError) throw uploadError
          const { error: linkError } = await supabase.from('treasury_entries').update({ receipt_storage_provider: 'supabase', receipt_storage_path: path, receipt_file_name: file.name }).eq('id', saved.id)
          if (linkError) throw linkError
        } catch (_) { setNotice('L’écriture est enregistrée mais le justificatif devra être ajouté ultérieurement.') }
      }
      setFormType(''); setReceipt(null); setEntryForm(defaultEntry())
    }, 'Écriture enregistrée dans le journal.')
  }

  const submitTransfer = async (event) => {
    event.preventDefault()
    const amount = centsOf(transferForm.amount)
    if (!Number.isSafeInteger(amount) || amount <= 0) return setError('Indiquez un montant positif valide.')
    if (opening && amount > balances[transferForm.from_account] &&
      !window.confirm('Le montant est supérieur au solde affiché de ce compte. Enregistrer quand même ?')) return
    await action(async () => {
      const { error: transferError } = await supabase.from('treasury_transfers').insert({
        from_account: transferForm.from_account, to_account: transferForm.from_account === 'cash' ? 'bank' : 'cash',
        amount_cents: amount, note: transferForm.note.trim() || null, occurred_at: timeOf(transferForm.date), created_by: user.id,
      })
      if (transferError) throw transferError
      setFormType(''); setTransferForm({ from_account: 'bank', amount: '', note: '', date: localDay() })
    }, 'Transfert enregistré, sans modifier le résultat financier.')
  }

  const saveOpening = async (event) => {
    event.preventDefault()
    const bank = centsOf(openingDraft.bank), cash = centsOf(openingDraft.cash)
    if (!Number.isSafeInteger(bank) || !Number.isSafeInteger(cash) || cash < 0) return setError('Indiquez deux soldes valides. La caisse espèces ne peut pas être négative.')
    if (!window.confirm(opening ? 'Remplacer le point de départ par les soldes réels actuels ? Les opérations antérieures au nouvel instant de référence resteront dans l’historique mais ne seront plus incluses dans les soldes affichés.' : 'Confirmer que ces deux montants correspondent aux soldes réellement constatés maintenant ? Les opérations antérieures restent consultables sans être comptées une seconde fois.')) return
    await action(async () => {
      const { error: saveError } = await supabase.from('treasury_opening').upsert({
        id: 1, bank_cents: bank, cash_cents: cash, as_of: new Date().toISOString(), updated_by: user.id, updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })
      if (saveError) throw saveError
    }, 'Soldes de référence enregistrés. Les opérations suivantes ajusteront les deux comptes.')
  }

  const confirmPayment = (payment) => {
    if (!window.confirm('Confirmer la réception du virement ' + payment.reference + ' de ' + formatMoney(payment.amount_cents) + ' ?')) return
    action(async () => { const { error: e } = await supabase.rpc('confirm_household_payment', { p_payment_id: payment.id }); if (e) throw e }, 'Virement confirmé et imputé aux cotisations ou charges concernées.')
  }
  const collectCash = (household) => {
    const outstanding = charges.filter((c) => c.household_id === household.id && c.status === 'open' && chargeResidualCents(c, allocations, payments) > 0)
    if (!outstanding.length || !window.confirm('Encaisser ' + formatMoney(dueByHousehold[household.id]) + ' en espèces pour ' + household.name + ' ?')) return
    action(async () => {
      const { error: e } = await supabase.rpc('admin_record_household_payment', { p_household_id: household.id, p_charge_ids: outstanding.map((c) => c.id), p_method: 'cash', p_note: 'Espèces reçues par le trésorier' })
      if (e) throw e
    }, 'Espèces encaissées et dettes rapprochées.')
  }
  const reimburse = (entry) => {
    const method = reimburseBy[entry.id] || 'bank_transfer'
    if (!window.confirm('Confirmer le remboursement de ' + formatMoney(entry.amount_cents) + ' par ' + (method === 'cash' ? 'la caisse espèces' : 'le compte bancaire') + ' ?')) return
    action(async () => {
      const { error: e } = await supabase.from('treasury_entries').update({
        status: 'settled', reimbursement_method: method, settled_by: user.id, settled_at: new Date().toISOString(),
      }).eq('id', entry.id).eq('status', 'pending')
      if (e) throw e
    }, 'Avance remboursée et débit affecté au bon compte.')
  }
  const openReceipt = async (entry) => {
    const { data: signed, error: e } = await supabase.storage.from('content').createSignedUrl(entry.receipt_storage_path, 600)
    if (e) setError(e.message)
    else window.open(signed.signedUrl, '_blank', 'noopener,noreferrer')
  }
  const exportRows = () => {
    const rows = [['Date', 'Type', 'Libellé', 'Catégorie', 'Compte', 'Entrée EUR', 'Sortie EUR', 'Statut', 'Notes']]
    activityFiltered.forEach((row) => rows.push([
      formattedDate(row.date), row.type === 'transfer' ? 'Transfert interne' : row.kind === 'income' ? 'Recette' : 'Dépense',
      row.label, row.category || '', row.type === 'transfer' ? (row.from_account + ' vers ' + row.to_account) : row.payment_method === 'personal_advance' && row.status === 'pending' ? 'Avance à rembourser' : row.account === 'cash' ? 'Espèces' : 'Banque',
      row.type === 'entry' && row.signed > 0 ? (row.signed / 100).toFixed(2).replace('.', ',') : '',
      row.type === 'entry' && row.signed < 0 ? (Math.abs(row.signed) / 100).toFixed(2).replace('.', ',') : '',
      row.type === 'entry' ? row.status : 'effectué', row.note || '',
    ]))
    csvDownload('amicale-danz-journal-' + localDay() + '.csv', rows)
  }

  const exportFullExcel = async () => {
    if (exporting || !data) return
    setExporting(true); setError('')
    try { const { downloadFinancialBackup } = await import('../lib/treasuryExport.js'); downloadFinancialBackup(data); setNotice('Sauvegarde Excel complète téléchargée sur votre appareil.') }
    catch (err) { setError(err.message || 'L’export Excel a échoué.') }
    finally { setExporting(false) }
  }
  const openForm = (type) => {
    setError(''); setNotice(''); setFormType(type)
    if (type === 'income' || type === 'expense') setEntryForm({ ...defaultEntry(), kind: type, category: type === 'income' ? 'don' : 'courses' })
  }

  if (loading) return <div className="skeleton-card tall" />
  if (!data) return <section className="tv2-panel"><div className="alert error">{error || 'Chargement impossible.'}</div><button type="button" onClick={() => window.location.reload()}>Réessayer</button></section>

  return <div className="tv2-content">
    {error && <div className="alert error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Fermer l’erreur">×</button></div>}
    {notice && <div className="alert success" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Fermer la confirmation">×</button></div>}

    {view !== 'settings' && <div className="tv2-actions">
      <button type="button" className="tv2-action tv2-action-primary" onClick={() => openForm('expense')}>− Dépense</button>
      <button type="button" className="tv2-action" onClick={() => openForm('income')}>＋ Recette</button>
      <button type="button" className="tv2-action" onClick={() => openForm('transfer')}>⇄ Transfert banque / caisse</button>
      <button type="button" className="tv2-action tv2-action-export" disabled={exporting} onClick={exportFullExcel}>{exporting ? "Création du fichier…" : "↓ Sauvegarde Excel complète"}</button>
    </div>}

    {formType && <section className="tv2-panel tv2-editor">
      <div className="tv2-section-heading"><div><span className="tv2-eyebrow">Saisie rapide</span><h2>{formType === 'transfer' ? 'Transférer entre deux comptes' : formType === 'income' ? 'Nouvelle recette' : 'Nouvelle dépense'}</h2></div><button type="button" className="tv2-close" aria-label="Fermer le formulaire" onClick={() => setFormType('')}>×</button></div>
      {formType === 'transfer' ? <form className="tv2-form" onSubmit={submitTransfer}>
        <div className="tv2-field-grid"><label>Depuis<select value={transferForm.from_account} onChange={(e) => setTransferForm({ ...transferForm, from_account: e.target.value })}><option value="bank">Compte bancaire → Espèces</option><option value="cash">Caisse espèces → Banque</option></select></label>
          <label>Montant (€)<input required inputMode="decimal" value={transferForm.amount} onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })} placeholder="100,00" /></label></div>
        <div className="tv2-field-grid"><label>Date<input type="date" required max={localDay()} value={transferForm.date} onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })} /></label><label>Note (facultatif)<input value={transferForm.note} onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })} placeholder="Retrait pour la caisse..." /></label></div>
        <p className="tv2-hint">Le montant passe d’un compte à l’autre. Le total de l’Amicale ne change pas.</p><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le transfert'}</button>
      </form> : <form className="tv2-form" onSubmit={submitEntry}>
        <div className="tv2-field-grid"><label>Libellé<input required maxLength={200} value={entryForm.label} onChange={(e) => setEntryForm({ ...entryForm, label: e.target.value })} placeholder={formType === 'income' ? 'Ex. Don lors du repas' : 'Ex. Courses pour le repas'} /></label>
          <label>Montant (€)<input required inputMode="decimal" value={entryForm.amount} onChange={(e) => setEntryForm({ ...entryForm, amount: e.target.value })} placeholder="0,00" /></label></div>
        <div className="tv2-field-grid"><label>Catégorie<select value={entryForm.category} onChange={(e) => setEntryForm({ ...entryForm, category: e.target.value })}>{Object.entries(formType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>{formType === 'income' ? 'Reçu sur' : 'Payé avec'}<select value={entryForm.payment_method} onChange={(e) => setEntryForm({ ...entryForm, payment_method: e.target.value })}>
            <option value="card">Carte / compte bancaire</option><option value="bank_transfer">Virement bancaire</option><option value="cash">Espèces</option>
            {formType === 'expense' && <option value="personal_advance">Avance d’un membre</option>}
          </select></label></div>
        {entryForm.payment_method === 'personal_advance' && <label>Avancé par<select required value={entryForm.advanced_by} onChange={(e) => setEntryForm({ ...entryForm, advanced_by: e.target.value })}><option value="">Sélectionner une personne</option>{profiles.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}{offline.filter((p) => !p.linked_user_id).map((p) => <option key={p.id} value={'offline:' + p.id}>{p.display_name} · sans compte</option>)}</select></label>}
        <div className="tv2-field-grid"><label>Date de l’opération<input type="date" required max={localDay()} value={entryForm.date} onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })} /></label>
          <label>Événement (facultatif)<select value={entryForm.event_id} onChange={(e) => setEntryForm({ ...entryForm, event_id: e.target.value })}><option value="">Sans événement</option>{(data.events || []).map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}</select></label></div>
        <label>Note (facultatif)<textarea rows="2" value={entryForm.note} onChange={(e) => setEntryForm({ ...entryForm, note: e.target.value })} /></label>
        {formType === 'expense' && <label>Justificatif (photo ou PDF)<input type="file" accept="image/*,.pdf" onChange={(e) => setReceipt(e.target.files?.[0] || null)} /></label>}
        {formType === 'income' && <p className="tv2-hint">Pour un paiement de cotisation ou de foyer, utilisez plutôt l’onglet Cotisations pour éviter une double écriture.</p>}
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Enregistrement…' : formType === 'income' ? 'Enregistrer la recette' : 'Enregistrer la dépense'}</button>
      </form>}
    </section>}

    {view === 'overview' && <>
      {!opening && <div className="tv2-setup-warning"><strong>À faire une fois : initialiser les soldes</strong><span>Indiquez le montant réel sur le compte bancaire et le liquide actuellement en caisse. Les montants ci-dessous ne seront fiables qu’après cette étape.</span><button type="button" onClick={() => onView('settings')}>Renseigner mes soldes →</button></div>}
      <div className="tv2-balances">
        <article className="tv2-balance tv2-bank"><span>Compte bancaire</span><strong>{opening ? formatMoney(balances.bank) : 'À initialiser'}</strong><small>Carte, virements et remboursements bancaires</small></article>
        <article className="tv2-balance tv2-cash"><span>Caisse espèces</span><strong>{opening ? formatMoney(balances.cash) : 'À initialiser'}</strong><small>Entrées et sorties de liquide</small></article>
        <article className="tv2-balance tv2-total"><span>Disponibilités totales</span><strong>{opening ? formatMoney(balances.bank + balances.cash) : 'À initialiser'}</strong><small>Banque + caisse, hors dettes et avances</small></article>
      </div>
      {opening && <p className="tv2-reference">Soldes calculés à partir du relevé du {new Date(opening.as_of).toLocaleString('fr-FR')} et des mouvements enregistrés depuis.</p>}
      <div className="tv2-metric-grid">
        <button type="button" className="tv2-metric" onClick={() => onView('memberships')}><span>À recevoir des foyers</span><strong>{formatMoney(dueTotal)}</strong><small>Dont cotisations : {formatMoney(dues)}</small></button>
        <button type="button" className="tv2-metric" onClick={() => onView('memberships')}><span>Virements à confirmer</span><strong>{pendingPayments.length}</strong><small>À rapprocher</small></button>
        <article className="tv2-metric"><span>Avances à rembourser</span><strong>{formatMoney(pendingAdvanceCents)}</strong><small>{pendingAdvances.length} avance{pendingAdvances.length > 1 ? 's' : ''} en attente</small></article>
        <article className="tv2-metric"><span>Ce mois-ci</span><strong>{formatMoney(monthNow.income - monthNow.expense)}</strong><small>{formatMoney(monthNow.income)} reçus · {formatMoney(monthNow.expense)} dépensés</small></article>
      </div>
      <div className="tv2-two-cols">
        <section className="tv2-panel"><div className="tv2-section-heading"><div><span className="tv2-eyebrow">Évolution · {year}</span><h2>Recettes et dépenses</h2></div></div>
          <div className="tv2-month-list">{monthly.map((m, i) => <div className="tv2-month" key={m.label}><span>{m.label.slice(0, 3)}</span><div className="tv2-bars"><span className="tv2-bar tv2-bar-in" style={{ width: (m.income / maxMonth * 100) + '%' }} title={'Recettes : ' + formatMoney(m.income)} /><span className="tv2-bar tv2-bar-out" style={{ width: (m.expense / maxMonth * 100) + '%' }} title={'Dépenses : ' + formatMoney(m.expense)} /></div><small>{formatMoney(m.income - m.expense)}</small></div>)}</div>
          <div className="tv2-legend"><span className="tv2-dot tv2-dot-in" /> Recettes <span className="tv2-dot tv2-dot-out" /> Dépenses</div>
        </section>
        <section className="tv2-panel"><div className="tv2-section-heading"><div><span className="tv2-eyebrow">À traiter</span><h2>Mes priorités</h2></div></div>
          {pendingPayments.length === 0 && pendingAdvances.length === 0 && dueTotal === 0 ? <p className="tv2-empty">Aucune opération urgente.</p> : <div className="tv2-priority-list">
            {pendingPayments.slice(0, 3).map((p) => <div key={p.id} className="tv2-priority"><div><strong>Virement · {householdById[p.household_id]?.name || 'Foyer'}</strong><small>{p.reference}</small></div><b>{formatMoney(p.amount_cents)}</b><button type="button" disabled={busy} onClick={() => confirmPayment(p)}>Confirmer</button></div>)}
            {pendingAdvances.slice(0, 3).map((e) => <div key={e.id} className="tv2-priority"><div><strong>Rembourser · {e.label}</strong><small>{profileById[e.advanced_by]?.full_name || profileById[offlineById[e.advanced_by_offline]?.linked_user_id]?.full_name || offlineById[e.advanced_by_offline]?.display_name || 'Membre'}</small></div><b>{formatMoney(e.amount_cents)}</b><button type="button" onClick={() => onView('operations')}>Voir</button></div>)}
            {dueTotal > 0 && <div className="tv2-priority"><div><strong>Dettes des foyers</strong><small>Relances et espèces</small></div><b>{formatMoney(dueTotal)}</b><button type="button" onClick={() => onView('memberships')}>Voir</button></div>}
          </div>}
        </section>
      </div>
      <section className="tv2-panel"><div className="tv2-section-heading"><div><span className="tv2-eyebrow">Journal</span><h2>Derniers mouvements</h2></div><button type="button" className="ghost-button" onClick={() => onView('operations')}>Tout afficher →</button></div>{renderOperations(activity.slice(0, 7), openReceipt)}</section>
    </>}

    {view === 'operations' && <>
      <section className="tv2-panel"><div className="tv2-section-heading"><div><span className="tv2-eyebrow">Historique complet</span><h2>Mes opérations</h2></div><div className="tv2-section-actions"><button type="button" className="primary-button" disabled={exporting} onClick={exportFullExcel}>{exporting ? 'Préparation…' : 'Sauvegarde complète Excel ↓'}</button><button type="button" className="ghost-button" onClick={exportRows}>CSV filtré</button></div></div>
        <div className="tv2-filters"><label>Rechercher<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Libellé ou note..." /></label>
          <label>Type<select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}><option value="all">Tout</option><option value="income">Recettes</option><option value="expense">Dépenses</option><option value="transfer">Transferts</option></select></label>
          <label>Compte<select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}><option value="all">Tous</option><option value="bank">Banque</option><option value="cash">Espèces</option></select></label>
          <label>Mois<input type="month" value={monthFilter === 'all' ? '' : monthFilter} onChange={(e) => setMonthFilter(e.target.value || 'all')} /></label>
        </div>
        <p className="tv2-hint">{activityFiltered.length} opération{activityFiltered.length > 1 ? 's' : ''} · Les transferts ne modifient pas le résultat.</p>
        {renderOperations(activityFiltered, openReceipt)}
      </section>
      {pendingAdvances.length > 0 && <section className="tv2-panel"><div className="tv2-section-heading"><div><span className="tv2-eyebrow">Dettes envers les membres</span><h2>Remboursements en attente</h2></div></div><div className="tv2-advance-list">
        {pendingAdvances.map((e) => <div className="tv2-advance" key={e.id}><div><strong>{e.label}</strong><small>{profileById[e.advanced_by]?.full_name || 'Membre'} · {formattedDate(e.occurred_at)}</small></div><b>{formatMoney(e.amount_cents)}</b><label>Rembourser depuis<select value={reimburseBy[e.id] || 'bank_transfer'} onChange={(evt) => setReimburseBy({ ...reimburseBy, [e.id]: evt.target.value })}><option value="bank_transfer">Compte bancaire</option><option value="cash">Caisse espèces</option></select></label><button type="button" className="primary-button" disabled={busy} onClick={() => reimburse(e)}>Marquer remboursé</button></div>)}
      </div></section>}
    </>}

    {view === 'memberships' && <>
      <div className="tv2-metric-grid">
        <article className="tv2-metric"><span>Amicalistes à jour</span><strong>{currentMemberCount}</strong><small>Comptes et fiches sans compte</small></article>
        <article className="tv2-metric"><span>Échéance sous 60 jours</span><strong>{expiringCount}</strong><small>Cotisations à renouveler</small></article>
        <article className="tv2-metric"><span>Dettes des foyers</span><strong>{formatMoney(dueTotal)}</strong><small>Dont cotisations : {formatMoney(dues)}</small></article>
        <article className="tv2-metric"><span>Avances à rembourser</span><strong>{formatMoney(pendingAdvanceCents)}</strong><small>Achats faits pour l’Amicale</small></article>
      </div>
      {pendingPayments.length > 0 && <section className="tv2-panel"><div className="tv2-section-heading"><h2>{pendingPayments.length} virement(s) à confirmer</h2></div><div className="tv2-list">{pendingPayments.map((p) => <div className="tv2-list-row" key={p.id}><div><strong>{householdById[p.household_id]?.name || 'Foyer'}</strong><small>{p.reference} · {formattedDate(p.declared_at)}</small></div><b>{formatMoney(p.amount_cents)}</b><button type="button" className="ghost-button" disabled={busy} onClick={() => confirmPayment(p)}>Confirmer</button></div>)}</div></section>}
      <section className="tv2-panel tv2-person-panel"><div className="tv2-section-heading"><div><span className="tv2-eyebrow">Annuaire financier</span><h2>Qui doit quoi ? À qui dois-je rembourser ?</h2></div><button type="button" className="ghost-button" onClick={exportFullExcel} disabled={exporting}>{exporting ? 'Préparation…' : 'Sauvegarde Excel complète ↓'}</button></div>
        <label className="tv2-search">Rechercher une personne<input value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)} placeholder="Nom ou e-mail" /></label>
        <div className="tv2-person-table-head"><span>Personne</span><span>Cotisation</span><span>Dette foyer</span><span>À rembourser</span><span></span></div>
        <div className="tv2-person-list">{roster.map((p) => {
          const indebted = dueByHousehold[p.household_id] || 0
          const outstandingAdvances = pendingAdvances.filter((e) => p.personType === 'offline' ? e.advanced_by_offline === p.id : e.advanced_by === p.id || (e.advanced_by_offline && offlineById[e.advanced_by_offline]?.linked_user_id === p.id))
          const advanceDue = outstandingAdvances.reduce((s,e) => s + e.amount_cents, 0)
          const valid = p.personType === 'offline' ? p.is_amicaliste && p.membership_valid_until >= localDay() : effectiveAmicaliste(p)
          return <button key={p.personType + p.personId} type="button" className={'tv2-person-row ' + (selectedPerson === p.personType + ':' + p.personId ? 'active' : '')} onClick={() => { setSelectedPerson(p.personType + ':' + p.personId); setChargeDraft({label:'',amount:'',category:'other',event_id:''}) }}>
            <span className="tv2-person-name"><strong>{p.display}</strong><small>{p.personType === 'offline' ? 'Sans compte' : p.email || 'Compte actif'}</small></span>
            <span className={'tv2-pill ' + (valid ? 'good' : 'alert')}>{valid ? 'À jour' : 'Non-amicaliste'}</span>
            <span className={'tv2-person-money ' + (indebted ? 'due' : '')}>{formatMoney(indebted)}</span>
            <span className={'tv2-person-money ' + (advanceDue ? 'due' : '')}>{formatMoney(advanceDue)}</span><span>›</span>
          </button>
        })}</div>
        {roster.length === 0 && <p className="tv2-empty">Aucune personne trouvée.</p>}
        <p className="tv2-hint">La colonne dette indique le solde du foyer, qui peut être partagé entre plusieurs personnes. Ouvrez une fiche pour voir les dettes attribuées individuellement.</p>
      </section>
      {selectedMember && <section className="tv2-panel tv2-person-detail"><div className="tv2-section-heading"><div><span className="tv2-eyebrow">Dossier financier individuel</span><h2>{selectedMember.display}</h2><p className="tv2-hint">Foyer : {householdById[selectedMember.household_id]?.name || 'Non renseigné'} · Cotisation {selectedMember.membership_valid_until ? 'valable jusqu’au ' + selectedMember.membership_valid_until : 'non renseignée'}</p></div><button type="button" className="tv2-close" aria-label="Fermer la fiche" onClick={() => setSelectedPerson(null)}>×</button></div>
        <div className="tv2-detail-grid"><div><h3>Cette personne doit à l’Amicale</h3>{relatedCharges.length ? relatedCharges.map((c) => <div className="tv2-detail-row" key={c.id}><div><strong>{c.label}</strong><small>{c.category} · {formattedDate(c.created_at)}</small></div><b>{formatMoney(chargeResidualCents(c,allocations,payments))}</b><button type="button" className="tv2-mini-button" disabled={busy} onClick={() => cancelDirectCharge(c)}>Annuler</button></div>) : <p className="tv2-empty">Aucune dette attribuée personnellement.</p>}
          {memberChargeDue > 0 && <div className="tv2-detail-actions"><button type="button" className="ghost-button" disabled={busy} onClick={() => collectDirect('cash')}>Encaisser {formatMoney(memberChargeDue)} en espèces</button><button type="button" className="ghost-button" disabled={busy} onClick={() => collectDirect('bank_transfer')}>Reçu sur compte bancaire</button></div>}
          <h3>Attribuer une dette</h3><form className="tv2-form" onSubmit={addDirectCharge}><div className="tv2-field-grid"><label>Libellé<input required value={chargeDraft.label} onChange={(e) => setChargeDraft({...chargeDraft,label:e.target.value})} placeholder="Repas, boissons, cotisation…" /></label><label>Montant (€)<input required inputMode="decimal" value={chargeDraft.amount} onChange={(e) => setChargeDraft({...chargeDraft,amount:e.target.value})} /></label></div><div className="tv2-field-grid"><label>Nature<select value={chargeDraft.category} onChange={(e) => setChargeDraft({...chargeDraft,category:e.target.value})}><option value="other">Autre</option><option value="membership">Cotisation</option><option value="meal">Repas</option><option value="drinks">Boissons</option><option value="activity">Sortie / activité</option><option value="adjustment">Régularisation</option></select></label><label>Événement<select value={chargeDraft.event_id} onChange={(e) => setChargeDraft({...chargeDraft,event_id:e.target.value})}><option value="">Sans événement</option>{data.events.map((e) => <option value={e.id} key={e.id}>{e.title}</option>)}</select></label></div><button type="submit" className="primary-button" disabled={busy}>Attribuer la dette</button></form>
          <p className="tv2-hint">Cotisation réglée : le statut d’un compte est activé automatiquement s’il existe un abonnement correspondant. Pour une fiche sans compte, le statut se règle dans Membres & accès.</p>
        </div><div><h3>L’Amicale doit à cette personne</h3>{relatedAdvances.length ? relatedAdvances.map((e) => <div className="tv2-detail-row" key={e.id}><div><strong>{e.label}</strong><small>{e.note || 'Avance personnelle'} · {formattedDate(e.occurred_at)}</small></div><b>{formatMoney(e.amount_cents)}</b><select aria-label="Compte de remboursement" value={reimburseBy[e.id] || 'bank_transfer'} onChange={(evt) => setReimburseBy({...reimburseBy,[e.id]:evt.target.value})}><option value="bank_transfer">Banque</option><option value="cash">Caisse</option></select><button type="button" className="tv2-mini-button" disabled={busy} onClick={() => reimburse(e)}>Remboursé</button></div>) : <p className="tv2-empty">Aucune avance à rembourser.</p>}
          <button type="button" className="ghost-button" onClick={() => { setEntryForm({...defaultEntry(),payment_method:'personal_advance',advanced_by:selectedMember.personType === 'offline' ? 'offline:' + selectedMember.id : selectedMember.id}); setFormType('expense'); window.scrollTo({top:0,behavior:'smooth'}) }}>＋ Enregistrer son achat pour l’Amicale</button></div></div>
      </section>}
      <section className="tv2-panel"><div className="tv2-section-heading"><h2>Soldes non attribués des foyers</h2><button type="button" className="ghost-button" onClick={onAdvanced}>Gestion avancée des foyers</button></div><div className="tv2-list">{households.filter((h) => dueByHousehold[h.id] > 0).map((h) => <div className="tv2-list-row tv2-debt" key={h.id}><div><strong>{h.name}</strong><small>{charges.filter((c) => c.household_id === h.id && c.status === 'open' && !c.user_id && !c.offline_person_id && !c.household_member_id).length} charge(s) du foyer non attribuées</small></div><b>{formatMoney(dueByHousehold[h.id])}</b><button type="button" className="ghost-button" disabled={busy} onClick={() => collectCash(h)}>Encaisser tout en espèces</button></div>)}{dueTotal === 0 && <p className="tv2-empty">Tous les foyers sont à jour.</p>}</div></section>
    </>}

    {view === 'settings' && <div className="tv2-two-cols">
      <section className="tv2-panel"><span className="tv2-eyebrow">Position comptable</span><h2>Initialiser ou rapprocher mes deux soldes</h2>
        <p>Relevez les montants réellement disponibles maintenant sur le compte bancaire et dans la caisse. Ce point de départ évite de compter deux fois les anciennes écritures.</p>
        {opening && <div className="tv2-reference-card"><strong>Dernière référence</strong><span>{new Date(opening.as_of).toLocaleString('fr-FR')}</span><span>Banque : {formatMoney(opening.bank_cents)} · Espèces : {formatMoney(opening.cash_cents)}</span></div>}
        <form className="tv2-form" onSubmit={saveOpening}><label>Solde bancaire réel (€)<input required inputMode="decimal" value={openingDraft.bank} onChange={(e) => setOpeningDraft({ ...openingDraft, bank: e.target.value })} placeholder="Ex. 1240,50" /></label>
          <label>Liquidités réellement en caisse (€)<input required inputMode="decimal" value={openingDraft.cash} onChange={(e) => setOpeningDraft({ ...openingDraft, cash: e.target.value })} placeholder="Ex. 185,00" /></label>
          <p className="tv2-hint">Le nouveau point de départ est daté au moment de l’enregistrement. Une modification ultérieure repart des nouveaux soldes réels, sans supprimer l’historique.</p>
          <button type="submit" className="primary-button" disabled={busy}>{opening ? 'Rapprocher les soldes actuels' : 'Initialiser mes comptes'}</button>
        </form>
      </section>
      <section className="tv2-panel"><span className="tv2-eyebrow">Organisation</span><h2>Comptabilité et sauvegardes</h2>
        <p>Aucun RIB n’est nécessaire. Suivez uniquement le compte bancaire et la caisse (liquide). Téléchargez une sauvegarde complète Excel, avec tous les mouvements et les dettes.</p>
        <div className="tv2-list-row"><div><strong>Compte bancaire</strong><small>Solde {opening ? formatMoney(balances.bank) : 'à initialiser'}</small></div></div>
        <div className="tv2-list-row"><div><strong>Caisse (liquide)</strong><small>Solde {opening ? formatMoney(balances.cash) : 'à initialiser'}</small></div></div>
        <div className="tv2-setting-actions"><button type="button" className="primary-button" disabled={exporting} onClick={exportFullExcel}>Sauvegarde complète Excel ↓</button><button type="button" className="ghost-button" onClick={() => onView('operations')}>Consulter / exporter le journal</button></div>
        <p className="tv2-hint">La banque et la caisse sont suivies séparément. Les avances personnelles n’impactent aucun solde avant leur remboursement.</p>
      </section>
    </div>}
  </div>
}

function renderOperations(rows, openReceipt) {
  if (!rows.length) return <p className="tv2-empty">Aucune opération pour cette sélection.</p>
  return <div className="tv2-operations">{rows.map((row) => <div className="tv2-operation" key={row.type + '-' + row.id}>
    <div className={'tv2-operation-icon ' + (row.type === 'transfer' ? 'transfer' : row.kind === 'income' ? 'income' : 'expense')}>{row.type === 'transfer' ? '⇄' : row.kind === 'income' ? '+' : '−'}</div>
    <div className="tv2-operation-details"><strong>{row.label}</strong><small>{formattedDate(row.date)} · {row.type === 'transfer' ? 'Transfert interne' : row.status === 'pending' ? 'Avance à rembourser' : (row.payment_method === 'personal_advance' ? 'Remboursé · ' : '') + (METHOD_NAMES[row.payment_method] || row.payment_method)}{row.category ? ' · ' + (EXPENSE_CATEGORIES[row.category] || INCOME_CATEGORIES[row.category] || row.category) : ''}</small></div>
    <strong className={'tv2-operation-amount ' + (row.type === 'transfer' ? 'transfer' : row.signed >= 0 ? 'income' : 'expense')}>{row.type === 'transfer' ? formatMoney(row.amount_cents) : row.status === 'pending' ? 'À rembourser ' + formatMoney(row.amount_cents) : (row.signed > 0 ? '+ ' : row.signed < 0 ? '− ' : '') + formatMoney(Math.abs(row.signed))}</strong>
    {row.receipt_storage_path && <button type="button" className="tv2-receipt" onClick={() => openReceipt(row)}>Justificatif ↗</button>}
  </div>)}</div>
}

// La session est fournie par le contexte existant, jamais par des identifiants en dur.
import { useAuth as useTreasuryIdentity } from '../context/AuthContext.jsx'
