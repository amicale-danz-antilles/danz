import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// Contract contains schema names only, no live counts, identifiers or hashes.
const groups = {
 public: 'admin_audit_log association_settings bureau_members content_attachments documents event_albums events gallery good_deal_submissions good_deals household_charges household_members household_payment_allocations household_payments households membership_requests membership_subscriptions news notification_preferences notification_settings offline_people poll_household_attendance poll_options poll_question_answers poll_questions poll_votes polls profiles push_subscriptions treasury_entries treasury_event_batches treasury_event_participants treasury_import_archive_lines treasury_import_batches treasury_opening treasury_transfers',
 private: 'good_deal_geocode_queue',
 danz_finance_v2_staging: 'batch_control exercises journal receipt_allocations receipt_batches receivable_items reprise',
 auth: 'audit_log_entries custom_oauth_providers flow_state identities instances mfa_amr_claims mfa_challenges mfa_factors mfa_recovery_code_sets mfa_recovery_codes oauth_authorizations oauth_client_states oauth_clients oauth_consents one_time_tokens refresh_tokens saml_providers saml_relay_states schema_migrations scim_tokens scim_users sessions sso_domains sso_providers users webauthn_challenges webauthn_credentials',
 storage: 'buckets buckets_analytics buckets_vectors migrations objects s3_multipart_uploads s3_multipart_uploads_parts vector_indexes'
}
export const requiredTables = Object.freeze(Object.entries(groups).flatMap(([schema, names]) => names.split(' ').map(name => schema+'.'+name)).sort())
export function parseSnapshot(input) {
 const rows = new Map()
 if(typeof input !== 'string')throw new Error('invalid_snapshot')
 for(const line of input.split(/\r?\n/).filter(x=>x.trim())) {
  let row
  try { row=JSON.parse(line) } catch { throw new Error('invalid_json_line') }
  if(!row || typeof row.table!=='string' || !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(row.table) || !/^(0|[1-9][0-9]*)$/.test(row.rows) || typeof row.rows!=='string' || typeof row.sha256!=='string' || !/^[a-f0-9]{64}$/.test(row.sha256))throw new Error('invalid_record')
  if(rows.has(row.table))throw new Error('duplicate_table')
  rows.set(row.table,row)
 }
 return rows
}
export function compareSnapshots(source, restored) {
 const a=parseSnapshot(source), b=parseSnapshot(restored), issues=[]
 for(const name of requiredTables) {
  if(!a.has(name))issues.push({code:'missing_required_source',table:name})
  if(!b.has(name))issues.push({code:'missing_required_restoration',table:name})
 }
 for(const [name,row] of a){
  const other=b.get(name)
  if(!other)issues.push({code:'missing_restoration',table:name})
  else if(row.rows!==other.rows || row.sha256!==other.sha256)issues.push({code:'row_count_or_digest_mismatch',table:name})
 }
 for(const name of b.keys())if(!a.has(name))issues.push({code:'unexpected_restoration',table:name})
 return {ok:issues.length===0,requiredTables:requiredTables.length,sourceTables:a.size,restoredTables:b.size,issues}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4)throw new Error('expected_two_private_snapshots')
  const report=compareSnapshots(readFileSync(process.argv[2],'utf8'),readFileSync(process.argv[3],'utf8'))
  // Only table names and issue codes; no row data, fingerprints or private paths.
  console.log(JSON.stringify(report,null,2))
  if(!report.ok)process.exitCode=1
 }catch{console.error('Snapshot comparison failed: invalid or unreadable input');process.exitCode=2}
}
