import { createFinancialXlsx, eur } from './treasuryXlsx.js'
import { ledgerBalances, accountFor, accountingDate, signedCents } from './treasuryLedger.js'
import { chargeResidualCents, effectiveAmicaliste, householdBalanceCents } from './finance.js'
import { buildEventGroups, eventOverview } from './eventFinance.js'

const date = (value) => value ? new Date(value).toISOString().slice(0, 10) : ''
const asDate = (value) => value ? new Date(value).toLocaleString('fr-FR') : ''
const method = { bank_transfer: 'Revolut / virement', card: 'Revolut / carte', cash: 'Caisse (liquide)', personal_advance: 'Avance personnelle', unassigned: 'À ventiler (origine Excel)' }
const nameOf = (item) => item?.display_name || item?.full_name || item?.name || item?.email || ''
export function buildFinancialSheets(data, takenAt = new Date()) {
  const { entries = [], transfers = [], households = [], members = [], profiles = [], offline = [], charges = [], payments = [], allocations = [], subscriptions = [], opening = null, importBatches = [], importArchive = [], audit = [] } = data
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
      ['Revolut', balances ? eur(Math.round(balances.bank)) : 'Non initialisé', 'Disponibilités calculées depuis le dernier relevé'],
      ['Caisse (liquide)', balances ? eur(Math.round(balances.cash)) : 'Non initialisé', 'Disponibilités calculées depuis le dernier relevé'],
      ['À ventiler (Excel)', balances ? eur(Math.round(balances.unassigned)) : 'Non initialisé', 'Mouvements dont le compte n’est pas encore connu'],
      ['Total comptable', balances ? eur(Math.round(balances.bank + balances.cash + balances.unassigned)) : 'Non initialisé', 'Revolut + caisse + mouvements à ventiler ; hors créances et avances'],
      ['Créances foyers', eur(Object.values(outstanding).reduce((s, n) => s + n, 0)), 'Dettes encore à recevoir des foyers'],
      ['Dont cotisations impayées', eur(charges.filter((c) => c.status === 'open' && c.category === 'membership').reduce((s, c) => s + chargeResidualCents(c, allocations, payments), 0)), 'Incluses dans les créances foyers'],
      ['Avances à rembourser', eur(pendingAdvances.reduce((s, e) => s + Number(e.amount_cents), 0)), 'Achats avancés par les membres'],
      ['Recettes enregistrées', eur(sums.income), 'Toutes les recettes réglées figurant au journal'],
      ['Dépenses enregistrées', eur(sums.expenses), 'Toutes les dépenses réglées figurant au journal'],
      ['Résultat enregistré', eur(sums.income - sums.expenses), 'Recettes moins dépenses ; ne constitue pas un solde bancaire'],
      ['Personnes avec compte actif', profiles.filter((p) => p.active).length, 'Hors personnes sans compte'],
      ['Personnes sans compte', offline.filter((p) => !p.linked_user_id).length, 'Associables plus tard à leur compte'],
      ['Import Excel', importBatches[0]?.source_filename || 'Aucun', importBatches[0] ? 'Somme du classeur au moment de la reprise : '+(importBatches[0].confirmed_closing_cents/100).toFixed(2)+' EUR' : ''],
      ['Virements à confirmer', payments.filter((p) => p.status === 'declared').length, 'Non encore comptabilisés sur Revolut'],
      ['Méthode', 'Comptes séparés', 'Transferts internes exclus du résultat ; une avance non remboursée ne débite pas la caisse'],
    ] },
    { name: 'Journal complet', headers: ['Date opération', 'Type', 'Libellé', 'Description et notes', 'Catégorie', 'Montant EUR', 'Sens EUR', 'Payé par', 'Compte concerné', 'État', 'Personne avance', 'Bénéficiaire / personne attribuée', 'Événement', 'Référence foyer', 'Justificatif nom', 'Justificatif chemin', 'Créé le', 'Remboursé le', 'Classeur importé', 'Ligne Excel', 'Date Excel originale', 'À vérifier', 'Annulé le', 'Motif annulation', 'Statut avant annulation', 'ID'], rows: entries.slice().sort((a,b) => new Date(accountingDate(a))-new Date(accountingDate(b))).map((e) => [
      asDate(accountingDate(e)), e.kind === 'income' ? 'Recette' : e.kind === 'expense' ? 'Dépense' : e.kind, e.label, e.note || '', e.category || '', eur(e.amount_cents), eur(e.status === 'settled' ? signedCents(e) : 0),
      method[e.payment_method] || e.payment_method, e.payment_method === 'personal_advance' && e.status === 'pending' ? 'Aucun (à rembourser)' : e.payment_method === 'unassigned' ? 'À ventiler (Excel)' : e.payment_method === 'cash' || e.reimbursement_method === 'cash' ? 'Caisse (liquide)' : 'Revolut',
      e.status, nameOf(people[e.advanced_by || e.advanced_by_offline]), nameOf(people[e.beneficiary_user_id || e.beneficiary_offline_id]), data.events?.find((ev) => ev.id === e.event_id)?.title || '', payments.find((p) => p.id === e.household_payment_id)?.reference || '', e.receipt_file_name || '', e.receipt_storage_path || '', asDate(e.created_at), asDate(e.settled_at), importBatches.find((b) => b.id === e.import_batch_id)?.source_filename || '', e.source_row || '', e.source_date || '', e.needs_review ? 'Oui' : 'Non', asDate(e.cancelled_at), e.cancel_reason || '', e.cancelled_previous_status || '', e.id,
    ]) },
    { name: 'Soldes et référence', headers: ['Compte ou référence', 'Montant EUR', 'Date', 'Note'], rows: [
      ['Revolut initial', opening ? eur(opening.bank_cents) : 'Non renseigné', opening ? asDate(opening.as_of) : '', 'Solde réel saisi par le trésorier'],
      ['Caisse liquide initiale', opening ? eur(opening.cash_cents) : 'Non renseigné', opening ? asDate(opening.as_of) : '', 'Solde réel saisi par le trésorier'],
      ['Revolut actuel', balances ? eur(balances.bank) : 'Non initialisé', asDate(takenAt), 'Mouvements enregistrés après le relevé'],
      ['Caisse liquide actuelle', balances ? eur(balances.cash) : 'Non initialisé', asDate(takenAt), 'Mouvements enregistrés après le relevé'],
      ['Report restant à ventiler', opening ? eur(opening.unassigned_cents || 0) : 'Non renseigné', opening ? asDate(opening.as_of) : '', 'Part du report d’origine encore non répartie'],
      ['Mouvements encore à ventiler', balances ? eur(balances.unassigned) : 'Non initialisé', asDate(takenAt), 'Mouvements importés sans moyen de paiement documenté'],
      ['Total comptable', balances ? eur(balances.bank + balances.cash + balances.unassigned) : 'Non initialisé', asDate(takenAt), 'Somme de Revolut, de la caisse et du non ventilé'],
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
    { name: 'Abonnements cotisation', headers: ['Nom du membre', 'Foyer', 'Début', 'Fin', 'Montant EUR', 'État', 'Activé le', 'ID dette', 'ID abonnement'], rows: subscriptions.map((s) => [nameOf(people[s.user_id || s.offline_person_id]), householdById[s.household_id]?.name || '', s.starts_on || '', s.ends_on || '', eur(s.amount_cents), s.status, asDate(s.activated_at), s.charge_id || '', s.id]) },
    { name: 'Avances et remboursements', headers: ['Date de dépense', 'Membre ayant avancé', 'Libellé', 'Description', 'Montant EUR', 'État', 'Mode remboursement', 'Remboursé le', 'Justificatif', 'ID'], rows: entries.filter((e) => e.payment_method === 'personal_advance').map((e) => [
      asDate(e.occurred_at), nameOf(people[e.advanced_by || e.advanced_by_offline]), e.label, e.note || '', eur(e.amount_cents), e.status, e.reimbursement_method === 'cash' ? 'Caisse (liquide)' : e.reimbursement_method ? 'Revolut' : 'En attente', asDate(e.settled_at), e.receipt_file_name || '', e.id,
    ]) },
    { name: 'Transferts internes', headers: ['Date', 'Depuis', 'Vers', 'Montant EUR', 'Motif', 'Créé le', 'État', 'Annulé le', 'Motif annulation', 'ID'], rows: transfers.map((t) => [asDate(t.occurred_at), t.from_account === 'cash' ? 'Caisse (liquide)' : 'Revolut', t.to_account === 'cash' ? 'Caisse (liquide)' : 'Revolut', eur(t.amount_cents), t.note || '', asDate(t.created_at), t.cancelled_at ? 'Annulé' : 'Effectué', asDate(t.cancelled_at), t.cancel_reason || '', t.id]) },
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
    { name: 'Reprises Excel', headers: ['Fichier','SHA256','Exercice','Report EUR','Recettes EUR','Dépenses EUR','Solde confirmé EUR','Cotisations','Date import','Note','ID'], rows: importBatches.map((b) => [b.source_filename,b.sha256,b.exercise,eur(b.opening_cents),eur(b.income_cents),eur(b.expense_cents),eur(b.confirmed_closing_cents),b.membership_count,asDate(b.imported_at),b.source_note||'',b.id]) },
    { name: 'Archives BILAN', headers: ['Fichier','Ligne source','Libellé recette','Recette EUR','Libellé dépense','Dépense EUR'], rows: importArchive.map((a) => [importBatches.find((b)=>b.id===a.batch_id)?.source_filename||'',a.source_row,a.income_label||'',a.income_cents==null?'':eur(a.income_cents),a.expense_label||'',a.expense_cents==null?'':eur(a.expense_cents)]) },
    { name: 'Historique corrections', headers: ['Date', 'Action', 'Écriture ou transfert', 'Détails des modifications', 'Auteur'], rows: audit.filter((a) => /^treasury_|^excel_2026_2027_/.test(a.action)).map((a) => [asDate(a.created_at),a.action,a.details?.entry_id || a.details?.transfer_id || a.details?.batch_id || '',JSON.stringify(a.details || {}),a.actor_id || '']) },
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
