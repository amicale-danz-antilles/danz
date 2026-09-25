import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import { chargeResidualCents, effectiveAmicaliste, formatMoney, householdBalanceCents, membershipLabel } from '../lib/finance.js'
import '../finance-households.css'

const categoryLabels = { membership: 'Cotisation amicaliste', meal: 'Repas', drinks: 'Consommations', activity: 'Activité / sortie', adjustment: 'Régularisation', other: 'Autre' }
const compactIban = (value = '') => value.replace(/\s+/g, '').toUpperCase()
const epcPayload = ({ name, iban, bic, amount, reference }) => ['BCD','002','1','SCT',(bic || '').replace(/\s+/g,''),(name || 'Amicale DANZ Antilles').slice(0,70),compactIban(iban),`EUR${(Number(amount || 0) / 100).toFixed(2)}`,'',String(reference || '').slice(0,140),''].join('\n')

export default function Household() {
  const { user, profile, refreshProfile } = useAuth()
  const [household, setHousehold] = useState(null)
  const [members, setMembers] = useState([])
  const [charges, setCharges] = useState([])
  const [payments, setPayments] = useState([])
  const [allocations, setAllocations] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [settings, setSettings] = useState(null)
  const [selectedCharges, setSelectedCharges] = useState([])
  const [prepared, setPrepared] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    if (!user?.id) return
    setLoading(true); setError('')
    const ownResult = await supabase.from('household_members').select('*').eq('user_id', user.id).maybeSingle()
    if (ownResult.error || !ownResult.data) { setError('Votre foyer n’a pas encore pu être chargé. Contactez un administrateur.'); setLoading(false); return }
    const householdId = ownResult.data.household_id
    const [householdResult, membersResult, chargesResult, paymentsResult, subscriptionsResult, settingsResult] = await Promise.all([
      supabase.from('households').select('*').eq('id', householdId).single(),
      supabase.from('household_members').select('*').eq('household_id', householdId).order('sort_order').order('created_at'),
      supabase.from('household_charges').select('*').eq('household_id', householdId).order('created_at', { ascending: false }),
      supabase.from('household_payments').select('*').eq('household_id', householdId).order('created_at', { ascending: false }),
      supabase.from('membership_subscriptions').select('*').eq('household_id', householdId).order('created_at', { ascending: false }),
      supabase.from('association_settings').select('*').eq('id', 1).single(),
    ])
    const firstError = [householdResult.error, membersResult.error, chargesResult.error, paymentsResult.error, subscriptionsResult.error, settingsResult.error].find(Boolean)
    if (firstError) setError('Certaines informations du foyer n’ont pas pu être actualisées.')
    const paymentRows = paymentsResult.data || []
    const allocationResult = paymentRows.length ? await supabase.from('household_payment_allocations').select('*').in('payment_id', paymentRows.map((row) => row.id)) : { data: [], error: null }
    const chargeRows = chargesResult.data || []; const allocationRows = allocationResult.data || []
    setHousehold(householdResult.data || null); setMembers(membersResult.data || []); setCharges(chargeRows); setPayments(paymentRows); setAllocations(allocationRows); setSubscriptions(subscriptionsResult.data || []); setSettings(settingsResult.data || null)
    setSelectedCharges(chargeRows.filter((charge) => charge.status === 'open' && chargeResidualCents(charge, allocationRows, paymentRows) > 0).map((charge) => charge.id))
    setLoading(false)
  }
  useEffect(() => { load() }, [user?.id])

  const balance = useMemo(() => householdBalanceCents(charges, allocations, payments), [charges, allocations, payments])
  const openCharges = useMemo(() => charges.filter((charge) => charge.status === 'open' && chargeResidualCents(charge, allocations, payments) > 0), [charges, allocations, payments])
  const pendingPayments = useMemo(() => payments.filter((payment) => ['prepared','declared'].includes(payment.status)), [payments])
  const selectedTotal = useMemo(() => openCharges.filter((charge) => selectedCharges.includes(charge.id)).reduce((sum, charge) => sum + chargeResidualCents(charge, allocations, payments), 0), [openCharges, selectedCharges, allocations, payments])
  const currentAmicaliste = effectiveAmicaliste(profile)
  const expiryTime = profile?.membership_valid_until ? new Date(`${profile.membership_valid_until}T12:00:00`).getTime() : 0
  const renewalWindow = currentAmicaliste && expiryTime - Date.now() <= 60 * 24 * 60 * 60 * 1000
  const pendingMembership = subscriptions.find((subscription) => subscription.user_id === user.id && subscription.status === 'pending')
  const visiblePrepared = prepared ? { ...prepared, status: 'prepared' } : pendingPayments[0]

  useEffect(() => {
    let cancelled = false
    if (!visiblePrepared || !settings?.iban) { setQrDataUrl(''); return undefined }
    QRCode.toDataURL(epcPayload({ name: settings.account_name || settings.association_name, iban: settings.iban, bic: settings.bic, amount: visiblePrepared.amount_cents, reference: visiblePrepared.reference }), { width: 280, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => { if (!cancelled) setQrDataUrl(url) }).catch(() => { if (!cancelled) setQrDataUrl('') })
    return () => { cancelled = true }
  }, [visiblePrepared?.id, visiblePrepared?.payment_id, visiblePrepared?.reference, settings?.iban, settings?.bic, settings?.account_name])

  const requestMembership = async () => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    const { error: requestError } = await supabase.rpc('request_membership_subscription')
    if (requestError) setError(requestError.message || 'Impossible de préparer la cotisation.')
    else { setMessage('La cotisation annuelle a été ajoutée aux sommes à régler. Votre statut sera activé après confirmation du paiement.'); await load(); refreshProfile?.() }
    setBusy(false)
  }
  const preparePayment = async () => {
    if (!selectedCharges.length || busy) return
    setBusy(true); setError(''); setMessage('')
    const { data, error: paymentError } = await supabase.rpc('prepare_household_payment', { p_charge_ids: selectedCharges })
    if (paymentError) setError(paymentError.message || 'Impossible de préparer le virement.')
    else { const row = Array.isArray(data) ? data[0] : data; setPrepared(row || null); setMessage('Virement préparé. Utilisez exactement le montant et la référence indiqués.'); await load() }
    setBusy(false)
  }
  const declarePayment = async (paymentId) => {
    if (!paymentId || busy) return
    setBusy(true); setError(''); setMessage('')
    const { error: declareError } = await supabase.rpc('declare_household_payment', { p_payment_id: paymentId })
    if (declareError) setError(declareError.message || 'Impossible de déclarer ce virement.')
    else { setPrepared(null); setMessage('Virement déclaré. Le trésorier le confirmera lorsqu’il apparaîtra sur le compte de l’Amicale.'); await load() }
    setBusy(false)
  }
  const copyTransfer = async (payment) => {
    const text = [settings?.account_name || settings?.association_name || 'Amicale DANZ Antilles', settings?.bank_name ? `Banque : ${settings.bank_name}` : null, settings?.iban ? `IBAN : ${settings.iban}` : null, settings?.bic ? `BIC : ${settings.bic}` : null, `Montant : ${formatMoney(payment.amount_cents)}`, `Référence : ${payment.reference}`].filter(Boolean).join('\n')
    try { await navigator.clipboard.writeText(text); setMessage('Coordonnées du virement copiées.') } catch { setMessage(text) }
  }

  return <div className="household-page">
    <PageTitle eyebrow="Mon compte" title="Mon foyer & paiements" text="Les adultes d’un même foyer partagent la même composition, les mêmes dettes et le même historique de règlements." />
    {error && <div className="alert error">{error}</div>}{message && <div className="alert success">{message}</div>}
    {loading ? <div className="skeleton-card tall" /> : <>
      <section className="household-summary-grid"><article className="household-summary-card"><span>Foyer</span><strong>{household?.name || 'Mon foyer'}</strong><small>{members.length} personne{members.length > 1 ? 's' : ''}</small></article><article className={`household-summary-card ${balance > 0 ? 'due' : 'ok'}`}><span>Solde à régler</span><strong>{formatMoney(balance)}</strong><small>{balance > 0 ? 'Détail ci-dessous' : 'Aucune dette en cours'}</small></article><article className="household-summary-card"><span>Statut</span><strong>{membershipLabel(profile)}</strong><small>Cotisation : {formatMoney(settings?.membership_fee_cents ?? 6000)} / an</small></article></section>
      <section className="text-panel household-members-panel"><div className="finance-heading"><div><span className="eyebrow">Composition</span><h2>Membres du foyer</h2></div></div><div className="household-member-list">{members.map((member) => <div className="household-member-row" key={member.id}><span className="household-member-avatar">{member.member_type === 'child' ? '🧒' : '👤'}</span><div><strong>{member.display_name}</strong><small>{member.member_type === 'child' ? member.age_category : member.user_id === user.id ? 'Votre compte' : 'Adulte du foyer'}</small></div></div>)}</div><p className="login-help">Les enfants n’ont pas de compte : seul leur prénom et leur catégorie d’âge sont enregistrés.</p></section>
      <section className="text-panel membership-panel"><div className="finance-heading"><div><span className="eyebrow">Amicale</span><h2>Cotisation amicaliste</h2></div><strong>{formatMoney(settings?.membership_fee_cents ?? 6000)} / an</strong></div>{currentAmicaliste && !renewalWindow ? <p>Votre adhésion est active jusqu’au <strong>{new Date(`${profile.membership_valid_until}T12:00:00`).toLocaleDateString('fr-FR')}</strong>. Le renouvellement sera proposé 60 jours avant l’échéance.</p> : pendingMembership ? <p>Votre {currentAmicaliste ? 'renouvellement' : 'adhésion'} est déjà dans les sommes à régler. Il sera activé après confirmation du règlement.</p> : <><p>{currentAmicaliste ? 'Votre échéance approche. Vous pouvez renouveler pour une nouvelle année.' : 'Devenez amicaliste pour 60 € par an. Les tarifs amicalistes seront automatiquement utilisés pour les événements concernés.'}</p><button type="button" className="primary-button" disabled={busy} onClick={requestMembership}>{currentAmicaliste ? 'Renouveler mon adhésion · 60 €' : 'Devenir amicaliste · 60 € / an'}</button></>}</section>
      <section className="text-panel"><div className="finance-heading"><div><span className="eyebrow">Compte du foyer</span><h2>Sommes à régler</h2></div><strong>{formatMoney(balance)}</strong></div>{!openCharges.length ? <div className="empty-state">Aucune somme à régler.</div> : <div className="finance-charge-list">{openCharges.map((charge) => { const residual = chargeResidualCents(charge, allocations, payments); const checked = selectedCharges.includes(charge.id); return <label className="finance-charge-row" key={charge.id}><input type="checkbox" checked={checked} onChange={(event) => setSelectedCharges((current) => event.target.checked ? [...new Set([...current, charge.id])] : current.filter((id) => id !== charge.id))} /><div><strong>{charge.label}</strong><small>{categoryLabels[charge.category] || charge.category} · {new Date(charge.created_at).toLocaleDateString('fr-FR')}</small></div><b>{formatMoney(residual)}</b></label> })}</div>}{openCharges.length > 0 && <div className="finance-payment-actions"><div><span>Sélection</span><strong>{formatMoney(selectedTotal)}</strong></div><button type="button" className="primary-button" disabled={busy || selectedTotal <= 0 || !settings?.iban} onClick={preparePayment}>Préparer le virement</button></div>}{!settings?.iban && balance > 0 && <div className="privacy-note"><strong>RIB à venir :</strong> le virement sera activé dès que le compte bancaire de l’Amicale sera renseigné. Le paiement en espèces reste possible auprès du trésorier.</div>}</section>
      {visiblePrepared && <section className="text-panel bank-transfer-panel"><div className="finance-heading"><div><span className="eyebrow">Virement bancaire</span><h2>{visiblePrepared.status === 'declared' ? 'En attente de confirmation' : 'Virement préparé'}</h2></div><strong>{formatMoney(visiblePrepared.amount_cents)}</strong></div><div className="bank-transfer-grid"><div><dl className="bank-details"><div><dt>Bénéficiaire</dt><dd>{settings?.account_name || settings?.association_name || 'Amicale DANZ Antilles'}</dd></div>{settings?.bank_name && <div><dt>Banque</dt><dd>{settings.bank_name}</dd></div>}<div><dt>IBAN</dt><dd>{settings?.iban || 'À renseigner'}</dd></div>{settings?.bic && <div><dt>BIC</dt><dd>{settings.bic}</dd></div>}<div><dt>Référence obligatoire</dt><dd><strong>{visiblePrepared.reference}</strong></dd></div></dl><p>Le QR code contient le bénéficiaire, l’IBAN, le montant et la référence. Si votre application bancaire ne le reconnaît pas, copiez simplement les coordonnées.</p></div>{qrDataUrl && <div className="payment-qr"><img src={qrDataUrl} alt={`QR de virement ${visiblePrepared.reference}`} /><small>QR de virement SEPA</small></div>}</div><div className="finance-button-row"><button type="button" className="secondary-button" onClick={() => copyTransfer(visiblePrepared)}>Copier les coordonnées</button>{visiblePrepared.status === 'prepared' && <button type="button" className="primary-button" disabled={busy} onClick={() => declarePayment(visiblePrepared.payment_id || visiblePrepared.id)}>J’ai effectué le virement</button>}</div></section>}
      <section className="text-panel"><div className="finance-heading"><div><span className="eyebrow">Historique</span><h2>Règlements</h2></div></div>{payments.length ? <div className="finance-history">{payments.map((payment) => <div className="finance-history-row" key={payment.id}><div><strong>{payment.reference}</strong><small>{payment.method === 'cash' ? 'Espèces' : payment.method === 'unassigned' ? 'À répartir' : 'Revolut (virement)'} · {payment.status === 'confirmed' ? 'Confirmé' : payment.status === 'declared' ? 'Déclaré, à vérifier' : payment.status === 'prepared' ? 'Préparé' : 'Annulé'}</small></div><b>{formatMoney(payment.amount_cents)}</b></div>)}</div> : <div className="empty-state">Aucun règlement enregistré.</div>}</section>
    </>}
  </div>
}
