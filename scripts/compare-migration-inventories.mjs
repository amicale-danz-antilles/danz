#!/usr/bin/env node
/**
 * Compare two PRIVATE source/target migration manifests.
 * Never commit real manifests: even UUID hashes and financial aggregates
 * must be handled as association accounting data.
 *
 * Shape:
 * {
 *   "tables": {"public.profiles":{"row_count":24,"keys_sha256":"64 hex digits"}, ...},
 *   "auth": {"row_count":25,"keys_sha256":"64 hex digits"},
 *   "files": {"r2":{"file_count":2,"total_bytes":123,"content_sha256":"64 hex digits"}}
 * }
 *
 * For financial tables include amount_cents_sum in both inventories.
 * Generate hashes using the same canonical sorted-UUID convention
 * on both PostgreSQL instances.
 */
import { readFile } from 'node:fs/promises'

const financialTables = new Set([
  'public.household_charges',
  'public.household_payments',
  'public.household_payment_allocations',
  'public.membership_subscriptions',
  'public.treasury_entries',
])
const digest = /^[0-9a-f]{64}$/i
const int = value => Number.isSafeInteger(value) && value >= 0
const allowedTop = new Set(['tables', 'auth', 'files'])
const errors = []
function fail(message) { errors.push(message) }
function validateRecord(name, record, kind) {
  if (!record || typeof record !== 'object') { fail(name + ': entrée absente'); return }
  if (kind === 'file') {
    if (!int(record.file_count) || !int(record.total_bytes) || !digest.test(record.content_sha256 || '')) fail(name + ': fichiers incomplets')
    return
  }
  if (!int(record.row_count) || !digest.test(record.keys_sha256 || '') || !digest.test(record.rows_sha256 || '')) fail(name + ': compteur ou empreinte manquant(e)')
  if ([...financialTables].some(table => name.startsWith(table + ' ')) && !Number.isSafeInteger(record.amount_cents_sum)) fail(name + ': somme en centimes obligatoire')
}
function compareRows(name, left, right, kind) {
  validateRecord(name + ' source', left, kind)
  validateRecord(name + ' cible', right, kind)
  if (!left || !right) return
  const keys = kind === 'file' ? ['file_count', 'total_bytes', 'content_sha256'] : ['row_count', 'keys_sha256', 'rows_sha256']
  if (financialTables.has(name)) keys.push('amount_cents_sum')
  for (const key of keys) if (left[key] !== right[key]) fail(name + ': ' + key + ' divergent')
}
function compareMaps(label, left, right, kind) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) {
    fail(label + ': inventaire absent ou invalide'); return
  }
  const union = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of union) {
    if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) fail(label + ': entrée manquante dans une base : ' + key)
    else compareRows(label === 'tables' ? key : label + '.' + key, left[key], right[key], kind)
  }
  if (!union.size) fail(label + ': inventaire vide')
}
function compare(source, target) {
  errors.length = 0
  for (const [name, obj] of [['source', source], ['cible', target]]) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail(name + ': format invalide')
    else for (const key of Object.keys(obj)) if (!allowedTop.has(key)) fail(name + ': propriété inattendue ' + key)
  }
  if (errors.length) return errors.slice()
  compareMaps('tables', source.tables, target.tables, 'table')
  compareRows('auth', source.auth, target.auth, 'table')
  compareMaps('files', source.files, target.files, 'file')
  return errors.slice()
}
const sample = {
  tables: {
    'public.profiles': { row_count: 2, keys_sha256: 'a'.repeat(64), rows_sha256: 'e'.repeat(64) },
    'public.treasury_entries': { row_count: 1, keys_sha256: 'b'.repeat(64), rows_sha256: 'f'.repeat(64), amount_cents_sum: 6000 },
  },
  auth: { row_count: 2, keys_sha256: 'c'.repeat(64), rows_sha256: '0'.repeat(64) },
  files: { r2: { file_count: 1, total_bytes: 123, content_sha256: 'd'.repeat(64) } },
}
if (process.argv[2] === '--self-test') {
  if (compare(sample, structuredClone(sample)).length) throw Error('Des inventaires identiques ont été refusés')
  const altered = structuredClone(sample)
  altered.tables['public.treasury_entries'].amount_cents_sum = 5900
  if (!compare(sample, altered).some(error => error.includes('amount_cents_sum'))) throw Error('Un écart comptable est passé inaperçu')
  const missing = structuredClone(sample)
  delete missing.tables['public.profiles']
  if (!compare(sample, missing).some(error => error.includes('entrée manquante'))) throw Error('Une table manquante est passée inaperçue')
  const changed = structuredClone(sample)
  changed.auth.keys_sha256 = 'e'.repeat(64)
  if (!compare(sample, changed).some(error => error.includes('keys_sha256'))) throw Error('Un compte manquant est passé inaperçu')
  process.stdout.write('Contrôles fictifs réussis : égalité, écart financier, table absente et UUID divergents.\n')
  process.exit(0)
}
if (process.argv.length !== 4) {
  process.stderr.write('Usage : node scripts/compare-migration-inventories.mjs source-prive.json cible-prive.json\n')
  process.exit(2)
}
let source, target
try {
  ;[source, target] = await Promise.all(process.argv.slice(2).map(async name => JSON.parse(await readFile(name, 'utf8'))))
} catch (_) {
  process.stderr.write('Impossible de lire les deux inventaires privés.\n')
  process.exit(2)
}
const differences = compare(source, target)
if (differences.length) {
  process.stderr.write('RAPPROCHEMENT REFUSÉ (' + differences.length + ' anomalie(s)) :\n')
  for (const item of differences) process.stderr.write('- ' + item + '\n')
  process.exit(1)
}
process.stdout.write('Inventaires concordants sur les compteurs, UUID, sommes et empreintes de fichiers fournis.\n')
process.stdout.write('Ne remplace pas la validation des contraintes, permissions, journaux et de la restauration.\n')
