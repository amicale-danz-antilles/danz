import { createFinancialXlsx, eur } from './treasuryXlsx.js'
import { ledgerBalances, accountFor, accountingDate, signedCents } from './treasuryLedger.js'
import { chargeResidualCents, effectiveAmicaliste, householdBalanceCents } from './finance.js'
import { buildEventGroups, eventOverview } from './eventFinance.js'

const date = (value) => value ? new Date(value).toISOString().slice(0, 10) : ''
const asDate = (value) => value ? new Date(value).toLocaleString('fr-FR') : ''
const method = { bank_transfer: 'Compte bancaire / virement', card: 'Compte bancaire / carte', cash: 'Caisse (liquide)', personal_advance: 'Avance personnelle' }
const nameOf = (item) => item?.display_name || item?.full_name || item?.name || item?.email || ''
export function buildFinancialSheets(data, takenAt = new Date()) {
  const { entries = [], transfers = [], households = [], members = [], profiles = [], offline = [], charges = [], payments = [], allocations = [], subscriptions = [], opening = null } = data
  const people = Object.fromEntries([...profiles, ...offline].map((p) => [p.id, p]))
  const householdById = Object.fromEntries(households.map((h) => [h.id, h]))
  const memberById = Object.fromEntries(members.map((m) => [m.id, m]))
  const profileHousehold = Object.fromEntries(members.filter((m) => m.user_id).map((m) => [m.user_id, m.household_id]))
  const sums = { income: 0, expenses: 0 }
  entries.filter((e) => e.status === 'settled').forEach((e) => {
    if (e.kind === 'income') sums.income += Number(e.amount_cents)
    if (e.kind === 'expense') sums.expenses += Number(e.amount_cents)
  })
  const pendingAdvances = entries.filter((e) => e.status === 'pending' && e.payment_method === 'personal_advance')
  const outstanding = Object.fromEntries(households.map((h) => [h.id, householdBalanceCents(charges.filter((c) => c.household_id === h.id), allocations, payments)]))
  const balances = ledgerBalances(opening, entries, transfers, takenAt)
  const memberSubscriptions = profiles.filter((p) => p.active).map((p) => [
    nameOf(p), p.email || '', 'Compte actif', effectiveAmicaliste(p, takenAt) ? 'À jour' : 'Non-amicaliste',
    p.membership_valid_until || '', householdById[profileHousehold[p.id]]?.name || '', p.id,
  ])
  const offlineSubscriptions = offline.filter((p) => !p.linked_user_id).map((p) => [
    nameOf(p), p.email || '', 'Sans compte', p.is_amicaliste && p.membership_valid_until >= date(takenAt) ? 'À jour' : 'Non-amicaliste',
    p.membership_valid_until || '', householdById[p.household_id]?.name || '', p.id,
  ])
  const sheets = [
    { name: 'Synthèse', headers: ['Indicateur', 'Valeur', 'Commentaire'], rows: [
      ['Édité le', asDate(takenAt), 'Sauvegarde complète de la trésorerie DANZ'],
      ['Solde de départ saisi', opening ? 'Oui' : 'Non', opening ? asDate(opening.as_of) : 'Les soldes réels ne sont pas encore initialisés'],
      ['Compte bancaire', balances ? eur(Math.round(balances.bank)) : 'Non initialisé', 'Disponibilités calculées depuis le dernier relevé'],
      ['Caisse (liquide)', balances ? eur(Math.round(balances.cash)) : 'Non initialisé', 'Disponibilités calculées depuis le dernier relevé'],
      ['Total disponible', balances ? eur(Math.round(balances.bank + balances.cash)) : 'Non initialisé', 'Banque + caisse ; hors créances et avances'],
      ['Créances foyers', eur(Object.values(outstanding).reduce((s, n) => s + n, 0)), 'Dettes encore à recevoir des foyers'],
      ['Dont cotisations impayées', eur(charges.filter((c) => c.status === 'open' && c.category === 'membership').reduce((s, c) => s + chargeResidualCents(c, allocations, payments), 0)), 'Incluses dans les créances foyers'],
      ['Avances à rembourser', eur(pendingAdvances.reduce((s, e) => s + Number(e.amount_cents), 0)), 'Achats avancés par les membres'],
      ['Recettes enregistrées', eur(sums.income), 'Toutes les recettes réglées figurant au journal'],
      ['Dépenses enregistrées', eur(sums.expenses), 'Toutes les dépenses réglées figurant au journal'],
      ['Résultat enregistré', eur(sums.income - sums.expenses), 'Recettes moins dépenses ; ne constitue pas un solde bancaire'],
      ['Personnes avec compte actif', profiles.filter((p) => p.active).length, 'Hors personnes sans compte'],
      ['Personnes sans compte', offline.filter((p) => !p.linked_user_id).length, 'Associables plus tard à leur compte'],
      ['Virements à confirmer', payments.filter((p) => p.status === 'declared').length, 'Non encore comptabilisés en banque'],
      ['Méthode', 'Comptes séparés', 'Transferts internes exclus du résultat ; une avance non remboursée ne débite pas la caisse'],
    ] },
    { name: 'Journal complet', headers: ['Date opération', 'Type', 'Libellé', 'Description et notes', 'Catégorie', 'Montant EUR', 'Sens EUR', 'Payé par', 'Compte concerné', 'État', 'Personne avance', 'Événement', 'Référence foyer', 'Justificatif nom', 'Justificatif chemin', 'Créé le', 'Remboursé le', 'ID'], rows: entries.slice().sort((a,b) => new Date(accountingDate(a))-new Date(accountingDate(b))).map((e) => [
      asDate(accountingDate(e)), e.kind === 'income' ? 'Recette' : e.kind === 'expense' ? 'Dépense' : e.kind, e.label, e.note || '', e.category || '', eur(e.amount_cents), eur(e.status === 'settled' ? signedCents(e) : 0),
      method[e.payment_method] || e.payment_method, e.payment_method === 'personal_advance' && e.status === 'pending' ? 'Aucun (à rembourser)' : e.payment_method === 'cash' || e.reimbursement_method === 'cash' ? 'Caisse (liquide)' : 'Compte bancaire',
      e.status, nameOf(people[e.advanced_by || e.advanced_by_offline]), data.events?.find((ev) => ev.id === e.event_id)?.title || '', payments.find((p) => p.id === e.household_payment_id)?.reference || '', e.receipt_file_name || '', e.receipt_storage_path || '', asDate(e.created_at), asDate(e.settled_at), e.id,
    ]) },
    { name: 'Soldes et référence', headers: ['Compte ou référence', 'Montant EUR', 'Date', 'Note'], rows: [
      ['Compte bancaire initial', opening ? eur(opening.bank_cents) : 'Non renseigné', opening ? asDate(opening.as_of) : '', 'Solde réel saisi par le trésorier'],
      ['Caisse liquide initiale', opening ? eur(opening.cash_cents) : 'Non renseigné', opening ? asDate(opening.as_of) : '', 'Solde réel saisi par le trésorier'],
      ['Compte bancaire actuel', balances ? eur(balances.bank) : 'Non initialisé', asDate(takenAt), 'Mouvements enregistrés après le relevé'],
      ['Caisse liquide actuelle', balances ? eur(balances.cash) : 'Non initialisé', asDate(takenAt), 'Mouvements enregistrés après le relevé'],
      ['Disponibilités totales', balances ? eur(balances.bank + balances.cash) : 'Non initialisé', asDate(takenAt), 'Somme des deux comptes'],
    ] },
    { name: 'Dettes des foyers', headers: ['Foyer', 'Personne', 'Sans compte', 'Catégorie', 'Libellé / description', 'Dette initiale EUR', 'Déjà réglé EUR', 'Restant EUR', 'Statut', 'Événement', 'Créé le', 'ID dette'], rows: charges.map((c) => {
      const paid = c.status === 'cancelled' ? 0 : Number(c.amount_cents) - chargeResidualCents(c, allocations, payments)
      const person = c.offline_person_id ? people[c.offline_person_id] : c.user_id ? people[c.user_id] : memberById[c.household_member_id]
      return [householdById[c.household_id]?.name || '', nameOf(person), c.offline_person_id ? 'Oui' : 'Non', c.category, c.label, eur(c.amount_cents), eur(paid), eur(c.status === 'cancelled' ? 0 : chargeResidualCents(c, allocations, payments)), c.status, data.events?.find((ev) => ev.id === c.event_id)?.title || '', asDate(c.created_at), c.id]
    }) },
    { name: 'Encaissements', headers: ['Date', 'Foyer', 'Montant EUR', 'Méthode', 'État', 'Référence', 'Note', 'Confirmé le', 'ID'], rows: payments.map((p) => [asDate(p.created_at), householdById[p.household_id]?.name || '', eur(p.amount_cents), method[p.method] || p.method, p.status, p.reference, p.note || '', asDate(p.confirmed_at), p.id]) },
    { name: 'Affectation paiements', headers: ['Paiement référence', 'Foyer', 'Dette libellé', 'Montant affecté EUR', 'État paiement', 'ID paiement', 'ID dette'], rows: allocations.map((a) => {
      const p = payments.find((row) => row.id === a.payment_id); const c = charges.find((row) => row.id === a.charge_id)
      return [p?.reference || '', householdById[p?.household_id]?.name || '', c?.label || '', eur(a.amount_cents), p?.status || '', a.payment_id, a.charge_id]
    }) },
    { name: 'Cotisations et membres', headers: ['Nom', 'E-mail', 'Type de fiche', 'Statut cotisation', 'Échéance', 'Foyer', 'ID'], rows: [...memberSubscriptions, ...offlineSubscriptions] },
    { name: 'Abonnements cotisation', headers: ['Nom du membre', 'Foyer', 'Début', 'Fin', 'Montant EUR', 'État', 'Activé le', 'ID dette', 'ID abonnement'], rows: subscriptions.map((s) => [nameOf(people[s.user_id]), householdById[s.household_id]?.name || '', s.starts_on || '', s.ends_on || '', eur(s.amount_cents), s.status, asDate(s.activated_at), s.charge_id || '', s.id]) },
    { name: 'Avances et remboursements', headers: ['Date de dépense', 'Membre ayant avancé', 'Libellé', 'Description', 'Montant EUR', 'État', 'Mode remboursement', 'Remboursé le', 'Justificatif', 'ID'], rows: entries.filter((e) => e.payment_method === 'personal_advance').map((e) => [
      asDate(e.occurred_at), nameOf(people[e.advanced_by || e.advanced_by_offline]), e.label, e.note || '', eur(e.amount_cents), e.status, e.reimbursement_method === 'cash' ? 'Caisse (liquide)' : e.reimbursement_method ? 'Compte bancaire' : 'En attente', asDate(e.settled_at), e.receipt_file_name || '', e.id,
    ]) },
    { name: 'Transferts internes', headers: ['Date', 'Depuis', 'Vers', 'Montant EUR', 'Motif', 'Créé le', 'ID'], rows: transfers.map((t) => [asDate(t.occurred_at), t.from_account === 'cash' ? 'Caisse (liquide)' : 'Compte bancaire', t.to_account === 'cash' ? 'Caisse (liquide)' : 'Compte bancaire', eur(t.amount_cents), t.note || '', asDate(t.created_at), t.id]) },
    { name: 'Bilan par événement', headers: ['Événement', 'Date', 'Visibilité', 'Participants', 'Foyers', 'Dettes attribuées', 'Dont cotisations', 'Total facturé EUR', 'Encaissé EUR', 'Reste dû EUR', 'ID événement'], rows: (data.events || []).map((event) => {
      const summary = eventOverview(event.id, data)
      return [event.title, asDate(event.starts_at), event.published ? 'Agenda public' : 'Fiche interne', summary.participants, summary.households,
        summary.charges, summary.memberships, eur(summary.total), eur(summary.paid), eur(summary.due), event.id]
    }) },
    { name: 'Détail par événement', headers: ['Événement', 'Foyer', 'Participant', 'Catégorie', 'Libellé', 'Facturé EUR', 'Déjà payé EUR', 'Restant EUR', 'État', 'ID dette', 'ID événement'], rows: (data.events || []).flatMap((event) =>
      buildEventGroups(event.id, data).flatMap((group) => group.charges.length
        ? group.charges.map((charge) => [event.title, group.name, charge.personName, charge.category, charge.label,
          eur(charge.amount_cents), eur(charge.paidCents), eur(charge.dueCents), charge.status, charge.id, event.id])
        : [[event.title,group.name,group.people.map((p)=>p.name).join(', '),'Présence sans dette','',eur(0),eur(0),eur(0),'Inscrit','',event.id]])
    ) },
    { name: 'Fiches sans compte', headers: ['Nom', 'E-mail', 'Notes', 'Foyer actuel', 'Statut amicaliste', 'Échéance', 'Compte lié', 'Créé le', 'ID'], rows: offline.map((p) => [p.display_name, p.email || '', p.notes || '', householdById[p.household_id]?.name || '', p.is_amicaliste ? 'Amicaliste' : 'Non-amicaliste', p.membership_valid_until || '', nameOf(people[p.linked_user_id]), asDate(p.created_at), p.id]) },
  ]
  return sheets
}
export function downloadFinancialBackup(data) {
  const sheets = buildFinancialSheets(data)
  const bytes = createFinancialXlsx(sheets)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'DANZ-sauvegarde-complete-tresorerie-' + new Date().toISOString().slice(0, 10) + '.xlsx'
  document.body.appendChild(anchor)
  anchor.click(); anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1200)
}
