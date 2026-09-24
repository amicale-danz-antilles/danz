import test from 'node:test'
import assert from 'node:assert/strict'
import { ledgerBalances, accountFor, accountingDate, signedCents } from '../src/lib/treasuryLedger.js'

const at = new Date('2026-10-01T00:00:00Z')
const opening = { bank_cents: 90000, cash_cents: 12000, as_of: '2026-09-24T15:00:00Z' }
const entry = (kind, account, cents, at, more = {}) =>
  ({ kind, payment_method: account, amount_cents: cents, occurred_at: at, status: 'settled', ...more })

test('sans position initiale le solde ne doit pas apparaître comme certain', () => {
  assert.equal(ledgerBalances(null, [], []), null)
})
test('les écritures antérieures au relevé ne sont jamais comptées deux fois', () => {
  const entries = [
    entry('income', 'bank_transfer', 8000, '2026-09-24T14:00:00Z'),
    entry('income', 'cash', 1200, '2026-09-24T16:00:00Z'),
    entry('expense', 'card', 4500, '2026-09-24T17:00:00Z'),
  ]
  assert.deepEqual(ledgerBalances(opening, entries, [], at), { bank: 85500, cash: 13200, unassigned: 0 })
})
test('un transfert banque vers espèces change les deux poches mais pas le total', () => {
  const transfer = { from_account: 'bank', to_account: 'cash', amount_cents: 5000, occurred_at: '2026-09-24T17:00:00Z' }
  const actual = ledgerBalances(opening, [], [transfer], at)
  assert.deepEqual(actual, { bank: 85000, cash: 17000, unassigned: 0 })
  assert.equal(actual.bank + actual.cash, opening.bank_cents + opening.cash_cents)
})
test('une avance personnelle en attente ne sort ni de la banque ni de la caisse', () => {
  const advance = entry('expense', 'personal_advance', 11150, '2026-09-24T17:00:00Z', { status: 'pending' })
  assert.deepEqual(ledgerBalances(opening, [advance], [], at), { bank: 90000, cash: 12000, unassigned: 0 })
})
test('une avance remboursée en espèces débite seulement la caisse à la date de remboursement', () => {
  const advance = entry('expense', 'personal_advance', 2500, '2026-09-01T10:00:00Z', {
    reimbursement_method: 'cash', settled_at: '2026-09-25T10:00:00Z',
  })
  assert.equal(accountFor(advance), 'cash')
  assert.equal(accountingDate(advance), '2026-09-25T10:00:00Z')
  assert.deepEqual(ledgerBalances(opening, [advance], [], at), { bank: 90000, cash: 9500, unassigned: 0 })
})
test('les revenus positifs et dépenses négatives utilisent des centimes entiers', () => {
  assert.equal(signedCents(entry('income', 'cash', 890, '2026-09-25T09:00:00Z')), 890)
  assert.equal(signedCents(entry('expense', 'card', 450, '2026-09-25T09:00:00Z')), -450)
})

test('une opération datée dans le futur ne gonfle pas les disponibilités', () => {
  const future = entry('income', 'cash', 9999, '2026-10-05T09:00:00Z')
  assert.deepEqual(ledgerBalances(opening, [future], [], at), { bank: 90000, cash: 12000, unassigned: 0 })
})

test('import Excel : le solde confirmé reste à affecter sans être attribué arbitrairement à la banque', () => {
  const excelOpening={bank_cents:0,cash_cents:0,unassigned_cents:11540,as_of:'2026-06-13T00:00:00Z'}
  const imported=[
    entry('income','unassigned',120750,'2026-09-22T12:00:00Z'),
    entry('expense','unassigned',42155,'2026-09-24T12:00:00Z')
  ]
  assert.deepEqual(ledgerBalances(excelOpening,imported,[],new Date('2026-09-25T00:00:00Z')),
    {bank:0,cash:0,unassigned:90135})
  imported[0].payment_method='bank_transfer'
  imported[1].payment_method='cash'
  assert.deepEqual(ledgerBalances(excelOpening,imported,[],new Date('2026-09-25T00:00:00Z')),
    {bank:120750,cash:-42155,unassigned:11540})
})
