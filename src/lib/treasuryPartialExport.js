import { createFinancialXlsx, eur } from './treasuryXlsx.js'
import { buildEditableSheet, editableEntry, normalizedEntry } from './treasuryRoundTrip.js'

// La sélection contient uniquement les identifiants demandés, jamais le reste du journal.
// Les feuilles de référence permettent de réaffecter une opération sans exposer
// les autres montants, soldes ou historiques de la trésorerie.
export function buildPartialFinancialSheets(data, ids, takenAt = new Date()) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || new Set(ids).size !== ids.length) {
    throw new Error('Sélectionnez entre 1 et 500 opérations distinctes.')
  }
  const available = new Map((data.entries || []).filter(editableEntry).map((entry) => [entry.id, entry]))
  const entries = ids.map((id) => available.get(id))
  if (entries.some((entry) => !entry)) throw new Error('Une écriture sélectionnée est absente ou protégée. Actualisez la trésorerie.')
  const subset = { ...data, entries }
  const eventNames = new Map((data.events || []).map((item) => [item.id, item.title]))
  const byId = new Map([...(data.profiles || []), ...(data.offline || [])].map((p) =>
    [p.id, p.display_name || p.full_name || p.name || p.email || '']))
  const journal = entries.map((entry) => {
    const item = normalizedEntry(entry)
    const personId = item.person.split(':')[1]
    return [
      item.id, item.occurredOn, item.kind === 'income' ? 'Recette' : 'Dépense', item.label,
      eur(item.amountCents), item.category, item.account, item.status,
      eventNames.get(item.eventId) || '', item.eventId, byId.get(personId) || '', item.person, item.note,
    ]
  })
  const totalIncome = entries.filter((e) => e.kind === 'income').reduce((sum, e) => sum + Number(e.amount_cents), 0)
  const totalExpense = entries.filter((e) => e.kind === 'expense').reduce((sum, e) => sum + Number(e.amount_cents), 0)
  return [
    buildEditableSheet(subset),
    { name: 'Périmètre exporté', headers: ['Information', 'Valeur', 'Précision'], rows: [
      ['Type de fichier', 'Sélection partielle modifiable', 'Seule la première feuille est réimportable'],
      ['Exporté le', takenAt.toISOString(), 'Instantané pour contrôler les modifications concurrentes'],
      ['Nombre d’écritures', entries.length, 'Les opérations absentes de ce classeur ne sont jamais supprimées'],
      ['Recettes sélectionnées', eur(totalIncome), 'Total des lignes sélectionnées, tous statuts confondus'],
      ['Dépenses sélectionnées', eur(totalExpense), 'Total des lignes sélectionnées, tous statuts confondus'],
      ['Attention', 'Pas de solde de compte', 'Ces sommes ne représentent ni le solde Revolut ni le solde espèces'],
      ['Importation', 'Seulement les cellules modifiées', 'Ne modifiez pas les ID, statuts, types ou contrôles'],
    ] },
    { name: 'Journal sélectionné', headers: [
      'ID', 'Date', 'Type', 'Libellé', 'Montant EUR', 'Catégorie', 'Mode', 'Statut',
      'Événement', 'ID événement', 'Personne', 'Identifiant personne', 'Note',
    ], rows: journal },
    { name: 'Références événements', headers: ['Événement', 'Date', 'ID événement'], rows:
      (data.events || []).map((e) => [e.title || '', String(e.starts_at || '').slice(0, 10), e.id]) },
    { name: 'Références personnes', headers: ['Personne', 'Type', 'Identifiant à saisir'], rows: [
      ...(data.profiles || []).map((p) => [p.full_name || p.display_name || p.email || '', 'Compte', 'user:' + p.id]),
      ...(data.offline || []).filter((p) => !p.linked_user_id).map((p) => [p.display_name || p.email || '', 'Sans compte', 'offline:' + p.id]),
    ] },
  ]
}

export function downloadPartialFinancialBackup(data, ids) {
  const now = new Date()
  const bytes = createFinancialXlsx(buildPartialFinancialSheets(data, ids, now))
  const url = URL.createObjectURL(new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'DANZ-tresorerie-selection-' + now.toISOString().slice(0, 10) + '.xlsx'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1200)
}
