// Comparison utility for privately generated, normalized snapshots.
// No actual member records or secrets are read by this module.
export const REQUIRED_TABLES = [
  'profiles','news','events','documents','gallery','membership_requests',
  'notification_preferences','push_subscriptions','good_deals','bureau_members',
  'polls','poll_options','poll_votes','good_deal_submissions','content_attachments',
  'admin_audit_log','event_albums','notification_settings','poll_questions',
  'poll_question_answers','association_settings','households','household_members',
  'household_charges','household_payments','household_payment_allocations',
  'membership_subscriptions','treasury_entries','poll_household_attendance'
]

const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
const integer = value => Number.isSafeInteger(value) && value >= 0
const integerSigned = value => Number.isSafeInteger(value)
const fail = reason => { throw new Error(reason) }
const sorted = list => [...list].sort().join('|')

export function inspectSnapshot(snapshot, name) {
  if (!snapshot || snapshot.schema_version !== 1) fail(name + ' : version de manifeste invalide')
  if (typeof snapshot.batch_id !== 'string' || !/^[a-z0-9_-]{8,80}$/i.test(snapshot.batch_id)) fail(name + ' : identifiant du lot manquant')
  if (!snapshot.tables || typeof snapshot.tables !== 'object' || Array.isArray(snapshot.tables)) fail(name + ' : inventaire de tables manquant')
  for (const table of REQUIRED_TABLES) if (!(table in snapshot.tables)) fail(name + ' : table obligatoire absente : ' + table)
  for (const [table, row] of Object.entries(snapshot.tables)) {
    if (!row || !integer(row.count) || !sha256(row.ids_sha256) || !sha256(row.canonical_rows_sha256)) fail(name + ' : comptage ou empreintes invalides pour ' + table)
  }
  const auth = snapshot.auth
  if (!auth || !integer(auth.accounts) || !integer(auth.profiles) || !integer(auth.unlinked_accounts) || !sha256(auth.ids_sha256) || auth.accounts < auth.profiles) fail(name + ' : inventaire d’identités invalide')
  if (auth.accounts - auth.profiles !== auth.unlinked_accounts) fail(name + ' : écart d’identités incohérent')
  const media = snapshot.media
  if (!media || !integer(media.files) || !integer(media.bytes) || !sha256(media.content_inventory_sha256)) fail(name + ' : inventaire des médias invalide')
  const finance = snapshot.finance
  const requiredFinance = ['charges_cents','confirmed_payments_cents','treasury_income_cents','treasury_expenses_cents','treasury_reimbursements_cents']
  if (!finance || requiredFinance.some(key => !integerSigned(finance[key]))) fail(name + ' : totaux financiers incomplets ou invalides')
  return {tableCount:Object.keys(snapshot.tables).length,authCount:auth.accounts,mediaCount:media.files}
}
export function compareMigrationSnapshots(source,target) {
  const src = inspectSnapshot(source,'Source')
  const dst = inspectSnapshot(target,'Cible')
  const errors = []
  const same = (label,a,b) => { if (a!==b) errors.push(label + ' différent') }
  same('Lot de migration',source.batch_id,target.batch_id)
  same('Ensemble des tables',sorted(Object.keys(source.tables)),sorted(Object.keys(target.tables)))
  for (const key of Object.keys(source.tables)) {
    if (!(key in target.tables)) continue
    for (const field of ['count','ids_sha256','canonical_rows_sha256']) same('Table '+key+' / '+field,source.tables[key][field],target.tables[key][field])
  }
  for (const field of ['accounts','profiles','unlinked_accounts','ids_sha256']) same('Identités / '+field,source.auth[field],target.auth[field])
  for (const field of ['files','bytes','content_inventory_sha256']) same('Médias / '+field,source.media[field],target.media[field])
  for (const field of ['charges_cents','confirmed_payments_cents','treasury_income_cents','treasury_expenses_cents','treasury_reimbursements_cents'])
    same('Trésorerie / '+field,source.finance[field],target.finance[field])
  return {ok:errors.length===0,errors,tableCount:src.tableCount,accountCount:src.authCount,mediaCount:src.mediaCount,targetTableCount:dst.tableCount}
}
