import test from 'node:test'
import assert from 'node:assert/strict'
import { ledgerBalances, accountFor, accountingDate, signedCents } from '../src/lib/treasuryLedger.js'

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
  assert.deepEqual(ledgerBalances(opening, entries), { bank: 85500, cash: 13200 })
})
test('un transfert banque vers espèces change les deux poches mais pas le total', () => {
  const transfer = { from_account: 'bank', to_account: 'cash', amount_cents: 5000, occurred_at: '2026-09-24T17:00:00Z' }
  const actual = ledgerBalances(opening, [], [transfer])
  assert.deepEqual(actual, { bank: 85000, cash: 17000 })
  assert.equal(actual.bank + actual.cash, opening.bank_cents + opening.cash_cents)
})
test('une avance personnelle en attente ne sort ni de la banque ni de la caisse', () => {
  const advance = entry('expense', 'personal_advance', 11150, '2026-09-24T17:00:00Z', { status: 'pending' })
  assert.deepEqual(ledgerBalances(opening, [advance]), { bank: 90000, cash: 12000 })
})
test('une avance remboursée en espèces débite seulement la caisse à la date de remboursement', () => {
  const advance = entry('expense', 'personal_advance', 2500, '2026-09-01T10:00:00Z', {
    reimbursement_method: 'cash', settled_at: '2026-09-25T10:00:00Z',
  })
  assert.equal(accountFor(advance), 'cash')
  assert.equal(accountingDate(advance), '2026-09-25T10:00:00Z')
  assert.deepEqual(ledgerBalances(opening, [advance]), { bank: 90000, cash: 9500 })
})
test('les revenus positifs et dépenses négatives utilisent des centimes entiers', () => {
  assert.equal(signedCents(entry('income', 'cash', 890, '2026-09-25T09:00:00Z')), 890)
  assert.equal(signedCents(entry('expense', 'card', 450, '2026-09-25T09:00:00Z')), -450)
})
