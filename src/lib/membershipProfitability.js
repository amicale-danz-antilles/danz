import { chargePaidCents, chargeResidualCents } from './finance.js'
import { buildEventGroups } from './eventFinance.js'

const toDate = (value) => value ? new Date(value) : null
const monthIndex = (value) => {
  const date = value instanceof Date ? value : toDate(value)
  return date && !Number.isNaN(date.getTime()) ? date.getUTCFullYear() * 12 + date.getUTCMonth() : null
}
const monthStartIndex = (year, month) => year * 12 + month

// Règle de gestion DANZ : 60 € = 12 mois, 20 € = 4 mois, soit 5 €/mois.
// Les autres montants utilisent leur période enregistrée comme solution de repli.
export function membershipPlanMonths(subscription) {
  const amount = Number(subscription?.amount_cents || 0)
  if (amount === 6000) return 12
  if (amount === 2000) return 4
  const start = monthIndex(subscription?.starts_on)
  const end = monthIndex(subscription?.ends_on)
  if (start == null || end == null || end < start) return 1
  return Math.max(1, end - start + 1)
}

export function membershipMonthlyCents(subscription) {
  const months = membershipPlanMonths(subscription)
  return months > 0 ? Number(subscription?.amount_cents || 0) / months : 0
}

export function subscriptionCoversMonth(subscription, targetMonthIndex) {
  if (subscription?.status !== 'paid') return false
  const start = monthIndex(subscription?.starts_on)
  if (start == null || targetMonthIndex == null) return false
  return targetMonthIndex >= start && targetMonthIndex < start + membershipPlanMonths(subscription)
}

export function membershipPoolForMonth(subscriptions = [], year, month) {
  const target = monthStartIndex(year, month)
  return subscriptions
    .filter((subscription) => subscriptionCoversMonth(subscription, target))
    .reduce((sum, subscription) => sum + membershipMonthlyCents(subscription), 0)
}

export function membershipRecognitionForYear(subscriptions = [], year, throughMonth = 11) {
  const lastMonth = Math.max(0, Math.min(11, throughMonth))
  let total = 0
  for (let month = 0; month <= lastMonth; month += 1) total += membershipPoolForMonth(subscriptions, year, month)
  return Math.round(total)
}

const personSubscriptionMatches = (person, subscription) => (
  (person?.type === 'account' && subscription.user_id === person.id)
  || (person?.type === 'offline' && subscription.offline_person_id === person.id)
)

export function isMemberForEvent(person, subscriptions = [], eventDate) {
  const target = monthIndex(eventDate)
  if (target == null || !person || person.type === 'child') return false
  return subscriptions.some((subscription) => personSubscriptionMatches(person, subscription) && subscriptionCoversMonth(subscription, target))
}

function eventMemberParticipationCount(event, data) {
  const participantRows = (data?.eventParticipants || []).filter((row) => row.event_id === event.id)
  if (participantRows.some((row) => row.pricing_group)) {
    return participantRows.filter((row) => row.pricing_group === 'member').length
  }
  const subscriptions = data?.subscriptions || []
  const people = buildEventGroups(event.id, data).flatMap((group) => group.people)
  const unique = new Map(people.map((person) => [person.key, person]))
  return [...unique.values()].filter((person) => isMemberForEvent(person, subscriptions, event.starts_at)).length
}

export function eventMembershipAllocation(event, data) {
  if (!event?.starts_at) return 0
  const eventDate = new Date(event.starts_at)
  if (Number.isNaN(eventDate.getTime())) return 0
  const year = eventDate.getUTCFullYear()
  const month = eventDate.getUTCMonth()
  const pool = membershipPoolForMonth(data?.subscriptions || [], year, month)
  if (!pool) return 0

  const sameMonth = (data?.events || []).filter((candidate) => {
    if (!candidate?.starts_at) return false
    const date = new Date(candidate.starts_at)
    return !Number.isNaN(date.getTime()) && date.getUTCFullYear() === year && date.getUTCMonth() === month
  })
  if (!sameMonth.length) return 0

  const weights = sameMonth.map((candidate) => ({ id: candidate.id, count: eventMemberParticipationCount(candidate, data) }))
  const totalParticipation = weights.reduce((sum, row) => sum + row.count, 0)
  if (totalParticipation > 0) {
    const eventWeight = weights.find((row) => row.id === event.id)?.count || 0
    return Math.round(pool * eventWeight / totalParticipation)
  }
  // Aucun amicaliste réellement rattaché : ne pas inventer une recette de cotisations.
  // L'ancien partage égal entre événements vides créait notamment des projections fantômes de 55 €.
  return 0
}

export function eventManagementEconomics(event, data) {
  const charges = (data?.charges || []).filter((charge) =>
    charge.event_id === event.id && charge.status !== 'cancelled' && charge.category !== 'membership'
  )
  const paidDirect = charges.reduce((sum, charge) => sum + chargePaidCents(charge.id, data?.allocations || [], data?.payments || []), 0)
  const dueDirect = charges.reduce((sum, charge) => sum + chargeResidualCents(charge, data?.allocations || [], data?.payments || []), 0)

  const linkedEntries = (data?.entries || []).filter((entry) => entry.event_id === event.id && entry.status !== 'cancelled')
  const otherIncome = linkedEntries
    .filter((entry) => entry.kind === 'income' && entry.status === 'settled' && !entry.household_payment_id)
    .reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0)
  // Une avance personnelle est déjà un coût économique de l’événement même si
  // l’Amicale ne l’a pas encore remboursée. Elle ne touche la trésorerie qu’au remboursement.
  const cost = linkedEntries
    .filter((entry) => entry.kind === 'expense')
    .reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0)

  const membershipAllocation = eventMembershipAllocation(event, data)
  const directReceived = paidDirect + otherIncome
  const balance = directReceived + membershipAllocation - cost
  const projected = balance + dueDirect

  const groups = buildEventGroups(event.id, data)
  const people = [...new Map(groups.flatMap((group) => group.people).map((person) => [person.key, person])).values()]
  const participantRows = (data?.eventParticipants || []).filter((row) => row.event_id === event.id)
  const hasPricingSnapshot = participantRows.some((row) => row.pricing_group)
  const memberCount = hasPricingSnapshot
    ? participantRows.filter((row) => row.pricing_group === 'member').length
    : people.filter((person) => isMemberForEvent(person, data?.subscriptions || [], event.starts_at)).length
  const childCount = hasPricingSnapshot ? participantRows.filter((row) => row.pricing_group === 'child').length : people.filter((person) => person.type === 'child').length
  const nonmemberCount = hasPricingSnapshot
    ? participantRows.filter((row) => row.pricing_group === 'nonmember' || row.pricing_group === 'guest').length
    : Math.max(0, people.length - memberCount - childCount)
  const projectedAssociationCost = Math.max(0, cost - directReceived - dueDirect)

  return {
    cost,
    directReceived,
    due: dueDirect,
    membershipAllocation,
    balance,
    projected,
    projectedAssociationCost,
    participants: people.length,
    memberCount,
    childCount,
    nonmemberCount,
  }
}

export function annualManagementEconomics(data, year, takenAt = new Date()) {
  const events = (data?.events || []).filter((event) => {
    const date = toDate(event.starts_at)
    return date && !Number.isNaN(date.getTime()) && date.getUTCFullYear() === year
  })
  const rows = events.map((event) => ({ event, ...eventManagementEconomics(event, data) }))
  const directReceived = rows.reduce((sum, row) => sum + row.directReceived, 0)
  const due = rows.reduce((sum, row) => sum + row.due, 0)
  const cost = rows.reduce((sum, row) => sum + row.cost, 0)
  const eventSupportNeeded = rows.reduce((sum, row) => sum + row.projectedAssociationCost, 0)

  const currentYear = takenAt.getUTCFullYear()
  const throughMonth = year < currentYear ? 11 : year > currentYear ? -1 : takenAt.getUTCMonth()
  const recognizedMembership = throughMonth < 0 ? 0 : membershipRecognitionForYear(data?.subscriptions || [], year, throughMonth)
  const fullYearMembership = membershipRecognitionForYear(data?.subscriptions || [], year, 11)

  return {
    year,
    events: rows,
    directReceived,
    due,
    cost,
    recognizedMembership,
    fullYearMembership,
    eventSupportNeeded,
    membershipHeadroom: fullYearMembership - eventSupportNeeded,
    currentBalance: directReceived + recognizedMembership - cost,
    projectedBalance: directReceived + due + fullYearMembership - cost,
  }
}
