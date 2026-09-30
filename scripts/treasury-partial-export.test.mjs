import test from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from 'fflate'
import { buildPartialFinancialSheets } from '../src/lib/treasuryPartialExport.js'
import { createFinancialXlsx } from '../src/lib/treasuryXlsx.js'
import { previewEditableRows } from '../src/lib/treasuryRoundTrip.js'

const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const c = '33333333-3333-4333-8333-333333333333'
const data = {
  entries: [
    { id: a, kind: 'expense', status: 'settled', label: 'Courses', amount_cents: 1234, payment_method: 'cash', occurred_at: '2026-09-22T12:00:00Z' },
    { id: b, kind: 'income', status: 'settled', label: 'Vente', amount_cents: 5000, payment_method: 'card', occurred_at: '2026-09-23T12:00:00Z' },
    { id: c, kind: 'income', status: 'settled', label: 'Cotisation', amount_cents: 6000, payment_method: 'bank_transfer', household_payment_id: 'pay1' },
  ],
  events: [{ id: 'event-id', title: 'Événement 1', starts_at: '2026-09-23T16:00:00Z' }],
  profiles: [{ id: 'user-id', full_name: 'Martin' }],
}

test('la sélection ne contient aucun montant ni écriture en dehors du périmètre', () => {
  const sheets = buildPartialFinancialSheets(data, [a], new Date('2026-09-30T12:00:00Z'))
  assert.equal(sheets.length, 5)
  assert.equal(sheets[0].name, 'Écritures modifiables')
  assert.deepEqual(sheets[0].rows.map((row) => row[0]), [a])
  assert.deepEqual(sheets[2].rows.map((row) => row[0]), [a])
  assert.equal(sheets[1].rows.find((row) => row[0] === 'Dépenses sélectionnées')[1].euros, 12.34)
  assert.equal(sheets[1].rows.find((row) => row[0] === 'Recettes sélectionnées')[1].euros, 0)
  const zip = unzipSync(createFinancialXlsx(sheets))
  const all = Object.entries(zip).filter(([name]) => name.endsWith('.xml')).map(([, bytes]) => strFromU8(bytes)).join('\n')
  assert.ok(all.includes('Courses'))
  assert.ok(!all.includes('Cotisation'))
  assert.ok(!all.includes('Vente'))
  assert.ok(!all.includes(b) && !all.includes(c))
})

test('une sélection partielle reste compatible avec la prévisualisation des imports', () => {
  const sheets = buildPartialFinancialSheets(data, [b])
  const row = sheets[0].rows[0].map((v) => v && typeof v === 'object' && 'euros' in v ? String(v.euros) : v)
  row[3] = 'Vente modifiée'
  const result = previewEditableRows([row], data)
  assert.equal(result.problems.length, 0)
  assert.deepEqual(result.changes.map((change) => change.id), [b])
  assert.equal(result.changes[0].next.label, 'Vente modifiée')
})

test('les écritures protégées, les doublons et les lots trop grands sont rejetés', () => {
  assert.throws(() => buildPartialFinancialSheets(data, []))
  assert.throws(() => buildPartialFinancialSheets(data, [a, a]))
  assert.throws(() => buildPartialFinancialSheets(data, [c]))
  assert.throws(() => buildPartialFinancialSheets(data, Array.from({ length: 501 }, (_, i) => String(i))))
})
