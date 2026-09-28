import { chargeResidualCents } from './finance.js'

const idOf = (person) => person?.personId || person?.id

export function chargeBelongsToPerson(charge, person, data) {
  if (!charge || !person) return false
  const personId = idOf(person)
  if (person.personType === 'offline') return charge.offline_person_id === personId
  if (person.personType !== 'account') return false
  if (charge.user_id === personId) return true
  if (charge.offline_person_id) {
    const alias = (data?.offline || []).find((row) => row.id === charge.offline_person_id)
    if (alias?.linked_user_id === personId) return true
  }
  if (charge.household_member_id) {
    const member = (data?.members || []).find((row) => row.id === charge.household_member_id)
    if (member?.user_id === personId) return true
  }
  return false
}

export function advanceBelongsToPerson(entry, person, data) {
  if (!entry || !person || entry.payment_method !== 'personal_advance') return false
  const personId = idOf(person)
  if (person.personType === 'offline') return entry.advanced_by_offline === personId
  if (person.personType !== 'account') return false
  if (entry.advanced_by === personId) return true
  if (entry.advanced_by_offline) {
    const alias = (data?.offline || []).find((row) => row.id === entry.advanced_by_offline)
    return alias?.linked_user_id === personId
  }
  return false
}

export function financialPositionForPerson(person, data) {
  const charges = (data?.charges || []).filter((charge) =>
    charge.status === 'open' && chargeBelongsToPerson(charge, person, data)
  )
  const advances = (data?.entries || []).filter((entry) =>
    entry.status === 'pending' && advanceBelongsToPerson(entry, person, data)
  )
  const debtCents = charges.reduce((sum, charge) =>
    sum + chargeResidualCents(charge, data?.allocations || [], data?.payments || []), 0)
  const advanceCents = advances.reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0)
  // Positif : l'Amicale doit de l'argent à la personne. Négatif : la personne doit à l'Amicale.
  const netCents = advanceCents - debtCents
  return { debtCents, advanceCents, netCents, charges, advances }
}
