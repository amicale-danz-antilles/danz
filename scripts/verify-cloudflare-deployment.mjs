// Read-only smoke test against the exact static build published to Pages.
import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const origin = new URL(process.argv[2] || 'https://danz-antilles.pages.dev').origin
if (!origin.startsWith('https://')) throw new Error('Une origine HTTPS est requise.')
const output = path.resolve('cloudflare-dist')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function request(resource, options = {}) {
  return fetch(new URL(resource, origin), { signal: AbortSignal.timeout(20000), ...options })
}
const root = await request('/', { redirect: 'manual' })
if (root.status !== 302 || new URL(root.headers.get('location'), origin).pathname !== '/danz/') {
  throw new Error('Redirection racine /danz/ incorrecte.')
}
const missing = await request('/danz/assets/danz-resource-does-not-exist.js')
if (missing.status !== 404) throw new Error('Une ressource absente doit renvoyer 404.')
const files = await readdir(path.join(output, 'danz'), { recursive: true, withFileTypes: true })
let checked = 0
for (const entry of files.filter((entry) => entry.isFile())) {
  const filename = path.join(entry.parentPath, entry.name)
  const resource = '/' + path.relative(output, filename).split(path.sep).map(encodeURIComponent).join('/')
  const response = await request(resource)
  if (!response.ok) throw new Error(`Ressource inaccessible (${response.status}) : ${resource}`)
  if (response.headers.get('x-content-type-options') !== 'nosniff' || response.headers.get('x-frame-options') !== 'DENY' || !response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")) {
    throw new Error(`En-têtes de sécurité manquants : ${resource}`)
  }
  if (['index.html', 'sw.js', 'manifest.webmanifest'].includes(path.relative(path.join(output, 'danz'), filename)) && !response.headers.get('cache-control')?.includes('no-cache')) {
    throw new Error(`Revalidation manquante : ${resource}`)
  }
  const expected = await readFile(filename)
  const actual = Buffer.from(await response.arrayBuffer())
  if (hash(expected) !== hash(actual)) throw new Error(`Le fichier publié diffère du build vérifié : ${resource}`)
  checked += 1
}
console.log(JSON.stringify({ origin, files_verified: checked, root_redirect: 302, missing_asset: 404, security_headers: true, sha256_match: true }))
