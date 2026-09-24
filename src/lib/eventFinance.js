import { chargePaidCents, chargeResidualCents, effectiveAmicaliste } from './finance.js'

export const eventKey = (type, id) => type + ':' + id

export function eventPeople(data) {
  const households = Object.fromEntries((data.households || []).map((h) => [h.id, h]))
  const members = data.members || []
  const profiles = Object.fromEntries((data.profiles || []).map((p) => [p.id, p]))
  const people = [
    ...(data.profiles || []).filter((p) => p.active).map((p) => {
      const householdId = members.find((m) => m.user_id === p.id)?.household_id
      return { key: eventKey('account', p.id), type: 'account', id: p.id, name: p.full_name || p.email || 'Compte', email: p.email || '', householdId,
        householdName: households[householdId]?.name || 'Sans foyer', amicaliste: effectiveAmicaliste(p), until: p.membership_valid_until || null }
    }),
    ...(data.offline || []).filter((p) => !p.linked_user_id).map((p) => ({
      key: eventKey('offline', p.id), type: 'offline', id: p.id, name: p.display_name, email: p.email || '',
      householdId: p.household_id, householdName: households[p.household_id]?.name || 'Foyer provisoire',
      amicaliste: Boolean(p.is_amicaliste && p.membership_valid_until && p.membership_valid_until >= new Date().toISOString().slice(0, 10)), until: p.membership_valid_until || null,
    })),
    ...members.filter((m) => m.member_type === 'child').map((m) => ({
      key: eventKey('child', m.id), type: 'child', id: m.id, name: m.display_name, email: '',
      householdId: m.household_id, householdName: households[m.household_id]?.name || 'Foyer',
      ageCategory: m.age_category, amicaliste: false, until: null,
    })),
  ]
  const byKey = Object.fromEntries(people.map((p) => [p.key, p]))
  for (const offline of data.offline || []) {
    if (!offline.linked_user_id) continue
    const profile = profiles[offline.linked_user_id]
    const person = byKey[eventKey('account', offline.linked_user_id)]
    if (profile && person) byKey[eventKey('offline', offline.id)] = { ...person, key: eventKey('offline', offline.id), name: person.name + ' (ancienne fiche)' }
  }
  return { people, byKey, households }
}

export function eventChargePersonKey(charge) {
  if (charge.offline_person_id) return eventKey('offline', charge.offline_person_id)
  if (charge.user_id) return eventKey('account', charge.user_id)
  if (charge.household_member_id) return eventKey('child', charge.household_member_id)
  return ''
}

export function eventParticipationKey(participant) {
  if (participant.offline_person_id) return eventKey('offline', participant.offline_person_id)
  if (participant.user_id) return eventKey('account', participant.user_id)
  if (participant.household_member_id) return eventKey('child', participant.household_member_id)
  return ''
}

export function eventOverview(eventId, data) {
  const rows = (data.charges || []).filter((c) => c.event_id === eventId && c.status !== 'cancelled')
  const paid = rows.reduce((sum, charge) => sum + chargePaidCents(charge.id, data.allocations || [], data.payments || []), 0)
  const total = rows.reduce((sum, charge) => sum + Number(charge.amount_cents), 0)
  const groups = buildEventGroups(eventId, data)
  return { total, paid, due: Math.max(0, total - paid), participants: new Set(groups.flatMap((g) => g.people.map((p) => p.key))).size,
    households: groups.length, charges: rows.length, memberships: rows.filter((r) => r.category === 'membership').length }
}

export function buildEventGroups(eventId, data) {
  const { byKey, households } = eventPeople(data)
  const groups = new Map()
  const makeGroup = (householdId) => {
    const key = householdId || 'missing-household'
    if (!groups.has(key)) groups.set(key, { householdId: key, name: households[key]?.name || 'Foyer non identifié',
      people: [], charges: [], total: 0, paid: 0, due: 0 })
    return groups.get(key)
  }
  const addPerson = (group, person) => {
    if (person && !group.people.some((p) => p.key === person.key)) group.people.push(person)
  }
  for (const row of data.eventParticipants || []) {
    if (row.event_id !== eventId) continue
    const key = eventParticipationKey(row)
    const person = byKey[key]
    if (person) addPerson(makeGroup(person.householdId), person)
  }
  for (const charge of data.charges || []) {
    if (charge.event_id !== eventId) continue
    const person = byKey[eventChargePersonKey(charge)]
    const group = makeGroup(charge.household_id)
    addPerson(group, person)
    group.charges.push({ ...charge, personKey: eventChargePersonKey(charge),
      personName: person?.name || (charge.household_member_id ? 'Enfant / autre membre' : 'Foyer'),
      paidCents: chargePaidCents(charge.id, data.allocations || [], data.payments || []),
      dueCents: charge.status === 'cancelled' ? 0 : chargeResidualCents(charge, data.allocations || [], data.payments || []) })
    if (charge.status !== 'cancelled') {
      group.total += Number(charge.amount_cents)
      group.paid += chargePaidCents(charge.id, data.allocations || [], data.payments || [])
      group.due += chargeResidualCents(charge, data.allocations || [], data.payments || [])
    }
  }
  return [...groups.values()].sort((a,b) => (b.due > 0 ? 1 : 0) - (a.due > 0 ? 1 : 0) || a.name.localeCompare(b.name,'fr'))
}
