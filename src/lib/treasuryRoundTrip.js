import { unzipSync, strFromU8 } from 'fflate'
import { eur } from './treasuryXlsx.js'

// Only independent journal entries are editable. Linked household payments and already
// reimbursed personal advances have their own protected accounting workflows.
export const editableEntry = (entry) => Boolean(entry && ['income', 'expense'].includes(entry.kind)
  && entry.status !== 'cancelled' && !entry.household_payment_id
  && (entry.payment_method !== 'personal_advance' || (entry.kind === 'expense' && entry.status === 'pending')))

export function normalizedEntry(entry) {
  const advance = entry.payment_method === 'personal_advance'
  return {
    id: String(entry.id),
    kind: String(entry.kind),
    status: String(entry.status),
    label: String(entry.label || ''),
    amountCents: Number(entry.amount_cents),
    category: String(entry.category || ''),
    account: String(entry.payment_method || ''),
    occurredOn: String(entry.occurred_at || entry.created_at || '').slice(0, 10),
    note: String(entry.note || ''),
    eventId: String(entry.event_id || ''),
    person: advance
      ? entry.advanced_by_offline ? 'offline:' + entry.advanced_by_offline : entry.advanced_by ? 'user:' + entry.advanced_by : ''
      : entry.beneficiary_offline_id ? 'offline:' + entry.beneficiary_offline_id : entry.beneficiary_user_id ? 'user:' + entry.beneficiary_user_id : '',
  }
}

export const EDITABLE_SHEET = 'Écritures modifiables'
export const EDITABLE_HEADERS = [
  'ID (ne pas modifier)', 'Statut (lecture)', 'Type (lecture)', 'Libellé',
  'Montant EUR', 'Catégorie', 'Compte', 'Date AAAA-MM-JJ', 'Note',
  'Événement ID', 'Personne (user:ID / offline:ID)', 'Référence de contrôle (ne pas modifier)',
]

export function buildEditableSheet(data) {
  return {
    name: EDITABLE_SHEET, headers: EDITABLE_HEADERS,
    rows: (data.entries || []).filter(editableEntry).map((entry) => {
      const baseline = normalizedEntry(entry)
      return [baseline.id, baseline.status, baseline.kind, baseline.label,
        eur(baseline.amountCents), baseline.category, baseline.account, baseline.occurredOn,
        baseline.note, baseline.eventId, baseline.person, JSON.stringify(baseline)]
    }),
  }
}

const getTags = (node, tag) => [...node.getElementsByTagNameNS('*', tag)]
const firstText = (node, tag) => getTags(node, tag)[0]?.textContent || ''
const colIndex = (ref) => [...String(ref).match(/^[A-Z]+/)?.[0] || ''].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1
const filename = (target) => {
  const clean = target.replace(/^\//, '').replace(/^xl\//, '')
  if (!/^worksheets\/sheet\d+\.xml$/.test(clean)) throw new Error('Chemin de feuille Excel inattendu.')
  return 'xl/' + clean
}
const xmlDoc = (bytes) => {
  const document = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  if (getTags(document, 'parsererror').length) throw new Error('Le fichier Excel contient du XML invalide.')
  return document
}

export async function readEditableWorkbook(file) {
  if (!file || !/\.xlsx$/i.test(file.name || '')) throw new Error('Choisissez un fichier .xlsx exporté depuis DANZ.')
  if (file.size > 15 * 1024 * 1024) throw new Error('Le fichier dépasse 15 Mo.')
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()))
  if (!archive['xl/workbook.xml'] || !archive['xl/_rels/workbook.xml.rels']) throw new Error('Classeur Excel invalide.')
  const workbook = xmlDoc(archive['xl/workbook.xml'])
  const sheet = getTags(workbook, 'sheet').find((item) => item.getAttribute('name') === EDITABLE_SHEET)
  if (!sheet) throw new Error('La feuille « Écritures modifiables » est absente. Réexportez les comptes depuis DANZ.')
  const id = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
  const rels = xmlDoc(archive['xl/_rels/workbook.xml.rels'])
  const rel = getTags(rels, 'Relationship').find((item) => item.getAttribute('Id') === id)
  if (!rel) throw new Error('La feuille Excel modifiable est introuvable.')
  const bytes = archive[filename(rel.getAttribute('Target') || '')]
  if (!bytes) throw new Error('La feuille modifiable ne peut pas être lue.')
  const shared = archive['xl/sharedStrings.xml'] ? getTags(xmlDoc(archive['xl/sharedStrings.xml']), 'si').map((item) => item.textContent) : []
  const document = xmlDoc(bytes)
  const rows = getTags(document, 'sheetData').flatMap((item) => getTags(item, 'row')).map((row) => {
    const values = []
    for (const cell of getTags(row, 'c')) {
      if (getTags(cell, 'f').length) throw new Error('Les formules ne sont pas autorisées dans la feuille modifiable.')
      const index = colIndex(cell.getAttribute('r'))
      if (index < 0 || index > 11) continue
      const raw = cell.getAttribute('t') === 'inlineStr' ? firstText(cell, 'is') : firstText(cell, 'v')
      values[index] = cell.getAttribute('t') === 's' ? shared[Number(raw)] || '' : raw
    }
    return values
  })
  if (JSON.stringify(rows[0]) !== JSON.stringify(EDITABLE_HEADERS)) throw new Error('Les en-têtes ont été modifiés. Utilisez le modèle DANZ sans déplacer les colonnes.')
  if (rows.length > 501) throw new Error('Un import ne peut modifier que 500 opérations au maximum.')
  return rows.slice(1).filter((r) => r.some((value) => String(value || '').trim() !== ''))
}

const moneyCents = (value) => {
  const amount = Number(String(value ?? '').trim().replace(',', '.'))
  return Number.isFinite(amount) && amount > 0 && amount <= 1000000
    && Math.abs(amount * 100 - Math.round(amount * 100)) < .00001 ? Math.round(amount * 100) : NaN
}
const normalizeExcelDate = (raw) => {
  const value=String(raw || '').trim()
  if (/^\d{5}(\.\d+)?$/.test(value)) {
    const date=new Date(Date.UTC(1899,11,30)+Math.round(Number(value)*86400000))
    return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0,10)
  }
  return value
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const keys = ['label', 'amountCents', 'category', 'account', 'occurredOn', 'note', 'eventId', 'person']

export function previewEditableRows(rows, data) {
  const current = Object.fromEntries((data.entries || []).filter(editableEntry).map((entry) => [entry.id, normalizedEntry(entry)]))
  const eventIds = new Set((data.events || []).map((event) => event.id))
  const changes = [], problems = [], seen = new Set()
  rows.forEach((row, index) => {
    const line = index + 2
    const id = String(row[0] || '').trim()
    try {
      if (!UUID.test(id) || seen.has(id)) throw new Error('Identifiant manquant, invalide ou répété.')
      seen.add(id)
      const baseline = JSON.parse(String(row[11] || ''))
      const now = current[id]
      if (!now || !baseline || baseline.id !== id) throw new Error('Cette écriture n’existe plus ou n’est pas modifiable.')
      if (JSON.stringify(now) !== JSON.stringify(baseline)) throw new Error('Écriture modifiée sur le site depuis cet export. Téléchargez un nouveau fichier.')
      if (String(row[1] || '') !== baseline.status || String(row[2] || '') !== baseline.kind) throw new Error('Le statut ou le type ne doit pas être modifié dans Excel.')
      const next = {
        ...baseline, label: String(row[3] || '').trim(), amountCents: moneyCents(row[4]),
        category: String(row[5] || '').trim(), account: String(row[6] || '').trim(),
        occurredOn: normalizeExcelDate(row[7]), note: String(row[8] || '').trim(),
        eventId: String(row[9] || '').trim(), person: String(row[10] || '').trim(),
      }
      if (!next.label || next.label.length > 250 || !Number.isSafeInteger(next.amountCents)) throw new Error('Libellé ou montant invalide.')
      if (next.category.length > 100 || next.note.length > 2000) throw new Error('Catégorie ou note trop longue.')
      if (!DATE.test(next.occurredOn) || Number.isNaN(Date.parse(next.occurredOn)) || next.occurredOn > new Date().toISOString().slice(0, 10)) throw new Error('Date invalide ou future.')
      if (next.eventId && !eventIds.has(next.eventId)) throw new Error('Identifiant d’événement inconnu.')
      if (next.person && !/^(user|offline):[0-9a-f-]{36}$/i.test(next.person)) throw new Error('Personne : utilisez user:ID ou offline:ID.')
      if (baseline.account === 'personal_advance' ? next.account !== 'personal_advance' : !['bank_transfer', 'cash', 'card', 'unassigned'].includes(next.account)) throw new Error('Mode de règlement non autorisé pour cette écriture.')
      if (baseline.account === 'personal_advance' && !next.person) throw new Error('Le bénéficiaire d’une avance est obligatoire.')
      const altered = keys.filter((key) => next[key] !== baseline[key])
      if (altered.length) changes.push({ id, line, baseline, next, altered })
    } catch (error) { problems.push({ line, message: error.message }) }
  })
  return { changes, problems }
}
