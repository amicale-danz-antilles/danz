import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

function check(url, key) {
  return spawnSync(process.execPath, ['scripts/verify-cloudflare-config.mjs'], {
    encoding: 'utf8', env: { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key },
  })
}
const url = 'https://example.supabase.co'
const jwt = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`
test('une publication exige une configuration Supabase publique complète', () => {
  assert.equal(check(url, 'sb_publishable_example').status, 0)
  assert.equal(check(url, jwt('anon')).status, 0)
  for (const [endpoint, key] of [[url, ''], ['', 'sb_publishable_example'], [url, 'sb_secret_example'], [url, jwt('service_role')], ['http://example.supabase.co', 'sb_publishable_example'], ['https://user:password@example.supabase.co', 'sb_publishable_example']]) {
    const result = check(endpoint, key)
    assert.notEqual(result.status, 0)
    assert.ok(!result.stderr.includes(key) || !key, 'ne pas imprimer la clé refusée')
  }
})
