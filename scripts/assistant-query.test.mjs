import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../supabase/functions/danz-assistant/index.ts', import.meta.url), 'utf8')

test('assistant news query uses publish_at, not nonexistent created_at', () => {
  const news = source.match(/admin\.from\("news"\)\.select\("[^"]+"\)\.order\("[^"]+"[^\n]*/)
  assert.ok(news, 'The assistant must load news from the live schema')
  assert.match(news[0], /\.order\("publish_at"/)
  assert.doesNotMatch(news[0], /created_at/)
})

test('assistant keeps owner authorization and human approval', () => {
  assert.match(source, /rpc\("danz_assistant_access"\)/)
  assert.match(source, /mode==="confirm"\|\|mode==="reject"/)
  assert.match(source, /eq\("status","pending"\)/)
})
