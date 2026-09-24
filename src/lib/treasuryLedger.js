// Grand livre simple : tous les montants sont en centimes entiers.
// Le relevé initial est une photographie des soldes à un instant donné.
export const accountFor = (entry) => {
  if (entry.payment_method === 'cash') return 'cash'
  if (entry.payment_method === 'personal_advance') return entry.reimbursement_method === 'cash' ? 'cash' : 'bank'
  return 'bank'
}
export const accountingDate = (entry) => entry.payment_method === 'personal_advance'
  ? (entry.settled_at || entry.occurred_at || entry.created_at)
  : (entry.occurred_at || entry.created_at)
export const signedCents = (entry) => {
  if (entry.kind === 'expense') return -Number(entry.amount_cents)
  return Number(entry.amount_cents)
}
export function ledgerBalances(opening, entries = [], transfers = []) {
  if (!opening) return null
  const balance = { bank: Number(opening.bank_cents), cash: Number(opening.cash_cents) }
  const from = new Date(opening.as_of).getTime()
  for (const entry of entries) {
    if (entry.status !== 'settled' || new Date(accountingDate(entry)).getTime() <= from) continue
    balance[accountFor(entry)] += signedCents(entry)
  }
  for (const transfer of transfers) {
    if (new Date(transfer.occurred_at).getTime() <= from) continue
    balance[transfer.from_account] -= Number(transfer.amount_cents)
    balance[transfer.to_account] += Number(transfer.amount_cents)
  }
  return balance
}
