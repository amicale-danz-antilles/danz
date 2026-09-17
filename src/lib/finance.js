export const formatMoney = (cents = 0) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100)

export const effectiveAmicaliste = (profile, at = new Date()) => {
  if (profile?.is_amicaliste !== true || !profile?.membership_valid_until) return false
  const limit = new Date(`${profile.membership_valid_until}T23:59:59`)
  return !Number.isNaN(limit.getTime()) && limit.getTime() >= at.getTime()
}

export const chargePaidCents = (chargeId, allocations = [], payments = []) => {
  const confirmed = new Set(payments.filter((payment) => payment.status === 'confirmed').map((payment) => payment.id))
  return allocations
    .filter((allocation) => allocation.charge_id === chargeId && confirmed.has(allocation.payment_id))
    .reduce((sum, allocation) => sum + Number(allocation.amount_cents || 0), 0)
}

export const chargeResidualCents = (charge, allocations = [], payments = []) => Math.max(0, Number(charge?.amount_cents || 0) - chargePaidCents(charge?.id, allocations, payments))

export const householdBalanceCents = (charges = [], allocations = [], payments = []) => charges
  .filter((charge) => charge.status !== 'cancelled')
  .reduce((sum, charge) => sum + chargeResidualCents(charge, allocations, payments), 0)

export const membershipLabel = (profile) => {
  if (!effectiveAmicaliste(profile)) return 'Non-amicaliste'
  return profile.membership_valid_until ? `Amicaliste jusqu’au ${new Date(`${profile.membership_valid_until}T12:00:00`).toLocaleDateString('fr-FR')}` : 'Amicaliste'
}

export const ageCategoriesFallback = ['0–5 ans', '6–12 ans', '13–17 ans']
