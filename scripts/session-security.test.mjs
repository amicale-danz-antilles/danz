import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { transformWithEsbuild } from 'vite'

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const session = (id) => ({ user: { id } })
const profile = (id, role = 'member') => ({ id, role, active: true, is_treasurer: role === 'admin' })

// Execute the actual component with deterministic hook scheduling and mocked
// Supabase responses. No real account, browser storage or network is used.
async function authHarness({ initialSession = Promise.resolve({ data: { session: null } }), readProfile = async (id) => ({ data: profile(id) }) } = {}) {
  const source = await readFile(new URL('../src/context/AuthContext.jsx', import.meta.url), 'utf8')
  const compiled = await transformWithEsbuild(source, 'AuthContext.jsx', { format: 'cjs', jsx: 'transform', jsxFactory: '__jsx', sourcemap: false })
  const slots = []
  let cursor = 0
  let dirty = true
  let value
  let authEvent
  let mediaPurges = 0
  let queuedEffects = []
  const cached = new Map()
  const changed = (before, after) => !before || before.length !== after.length || after.some((item, index) => !Object.is(item, before[index]))
  const hooks = {
    createContext: () => ({ Provider: {} }),
    useContext: () => value,
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, (next) => {
        const updated = typeof next === 'function' ? next(slots[index].value) : next
        if (!Object.is(updated, slots[index].value)) { slots[index].value = updated; dirty = true }
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { current: initial }
      return slots[index]
    },
    useMemo(fn, deps) {
      const index = cursor++
      if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { value: fn(), deps }
      return slots[index].value
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps) },
    useEffect(fn, deps) {
      const index = cursor++
      if (!slots[index] || changed(slots[index].deps, deps)) {
        const previous = slots[index]
        slots[index] = { deps, cleanup: previous?.cleanup }
        queuedEffects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = fn() })
      }
    },
  }
  const harness = { online: true, readProfile }
  const supabase = {
    auth: {
      getSession: () => initialSession,
      onAuthStateChange: (fn) => { authEvent = fn; return { data: { subscription: { unsubscribe() {} } } } },
      signOut: async () => { authEvent('SIGNED_OUT', null); return { error: null } },
    },
    from: () => ({ select: () => ({ eq: (_, id) => ({ maybeSingle: () => harness.readProfile(id) }) }) }),
  }
  const module = { exports: {} }
  const context = vm.createContext({
    module, exports: module.exports,
    __jsx: (_, props) => props.value,
    window: { setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    require(name) {
      if (name === 'react') return hooks
      if (name.endsWith('/supabase.js')) return { supabase, isSupabaseConfigured: true }
      if (name.endsWith('/mediaStorage.js')) return { clearPrivateMediaUrlCache: () => { mediaPurges += 1 } }
      if (name.endsWith('/useOnlineStatus.js')) return () => harness.online
      if (name.endsWith('/offlineCache.js')) return {
        readOfflineData: (id) => cached.get(id),
        saveOfflineData: (id, _, data) => cached.set(id, data),
        clearOfflineData: (id) => cached.delete(id),
      }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  new vm.Script(compiled.code).runInContext(context)
  harness.render = () => {
    let rounds = 0
    while (dirty) {
      assert.ok(rounds++ < 30, 'Hook state must settle')
      dirty = false; cursor = 0
      value = module.exports.AuthProvider({ children: null })
      const effects = queuedEffects; queuedEffects = []
      effects.forEach((run) => run())
    }
    return value
  }
  harness.settle = async () => {
    for (let index = 0; index < 12; index += 1) { await Promise.resolve(); harness.render() }
    return value
  }
  harness.emit = (event, next) => { authEvent(event, next); harness.render() }
  harness.state = () => value
  harness.mediaPurges = () => mediaPurges
  harness.cached = cached
  harness.render()
  await harness.settle()
  return harness
}

test('a changed account never inherits the previous administrator after a profile error', async () => {
  const h = await authHarness({ readProfile: async (id) => id === 'admin' ? { data: profile(id, 'admin') } : { error: new Error('network unavailable') } })
  h.emit('SIGNED_IN', session('admin')); await h.settle()
  assert.equal(h.state().isAdmin, true)
  const purgesBefore = h.mediaPurges()
  h.emit('SIGNED_IN', session('member')); await h.settle()
  assert.equal(h.state().profile, null)
  assert.equal(h.state().isAdmin, false)
  assert.equal(h.state().hasAccess, false)
  assert.ok(h.mediaPurges() > purgesBefore)
})

test('late profile responses cannot restore an old account after switching or logout', async () => {
  const old = deferred()
  const h = await authHarness({ readProfile: (id) => id === 'old' ? old.promise : Promise.resolve({ data: profile(id) }) })
  h.emit('SIGNED_IN', session('old'))
  h.emit('SIGNED_IN', session('new')); await h.settle()
  old.resolve({ data: profile('old', 'admin') }); await h.settle()
  assert.equal(h.state().profile.id, 'new')
  assert.equal(h.state().isAdmin, false)
  h.emit('SIGNED_OUT', null); await h.settle()
  assert.equal(h.state().user, null)
  assert.equal(h.state().profile, null)
  assert.equal(h.state().hasAccess, false)
  assert.equal(h.cached.has('new'), false)
})

test('logout invalidates a profile response already in flight', async () => {
  const pending = deferred()
  const h = await authHarness({ readProfile: () => pending.promise })
  h.emit('SIGNED_IN', session('admin'))
  h.emit('SIGNED_OUT', null)
  pending.resolve({ data: profile('admin', 'admin') }); await h.settle()
  assert.equal(h.state().user, null)
  assert.equal(h.state().profile, null)
  assert.equal(h.state().isAdmin, false)
  assert.equal(h.cached.has('admin'), false)
})

test('a delayed getSession result cannot replace a newer authentication callback', async () => {
  const initial = deferred()
  const h = await authHarness({ initialSession: initial.promise })
  h.emit('SIGNED_IN', session('new')); await h.settle()
  initial.resolve({ data: { session: session('old') } }); await h.settle()
  assert.equal(h.state().user.id, 'new')
  assert.equal(h.state().profile.id, 'new')
})

test('cached administrator profiles allow offline reading and require fresh online verification for administration', async () => {
  const h = await authHarness({ readProfile: async (id) => ({ data: profile(id, 'admin') }) })
  h.emit('SIGNED_IN', session('admin')); await h.settle()
  assert.equal(h.state().isAdmin, true)
  h.online = false; h.state().refreshProfile(); await h.settle()
  assert.equal(h.state().hasAccess, true)
  assert.equal(h.state().isAdmin, false)
  h.online = true
  h.readProfile = async () => ({ error: new Error('network unavailable') })
  h.state().refreshProfile(); await h.settle()
  assert.equal(h.state().hasAccess, true)
  assert.equal(h.state().isAdmin, false)
  assert.equal(h.state().isTreasurer, false)
  h.readProfile = async (id) => ({ data: profile(id, 'admin') })
  h.state().refreshProfile(); await h.settle()
  assert.equal(h.state().isAdmin, true)
})

async function mediaHarness(sign) {
  const source = await readFile(new URL('../src/lib/mediaStorage.js', import.meta.url), 'utf8')
  const compiled = await transformWithEsbuild(source, 'mediaStorage.js', { format: 'cjs', sourcemap: false })
  const module = { exports: {} }
  const context = vm.createContext({ module, exports: module.exports, require: () => ({ supabase: {
    storage: { from: () => ({ createSignedUrls: sign }) },
    functions: { invoke: sign },
  } }) })
  new vm.Script(compiled.code).runInContext(context)
  return module.exports
}

for (const provider of ['supabase', 'r2']) {
  test(`private ${provider} links and pending requests are invalidated when the session changes`, async () => {
    let calls = 0
    let pending
    const signed = () => provider === 'supabase' ? { data: [{ signedUrl: `https://private.example/${calls}` }] } : { data: { urls: { media: `https://private.example/${calls}` } } }
    const media = await mediaHarness(async () => { calls += 1; return pending ? pending.promise : signed() })
    const item = { id: 'media', storage_provider: provider, storage_path: 'protected/file.jpg' }
    const options = { entity: 'album', fallbackBucket: 'gallery' }
    assert.equal((await media.resolvePrivateMediaBatch([item], options)).size, 1)
    await media.resolvePrivateMediaBatch([item], options)
    assert.equal(calls, 1, 'same session can reuse its signed link')
    media.clearPrivateMediaUrlCache()
    pending = deferred()
    const stale = media.resolvePrivateMediaBatch([item], options)
    media.clearPrivateMediaUrlCache()
    pending.resolve(signed())
    assert.equal((await stale).size, 0, 'old session response is discarded')
    pending = null
    await media.resolvePrivateMediaBatch([item], options)
    assert.equal(calls, 3, 'next session must obtain a new authorization')
  })
}

async function privateMediaResponse(savedAt) {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
  const listeners = new Map()
  let removed = false
  const cached = new Response('private thumbnail', { headers: savedAt ? { 'X-Danz-Cached-At': savedAt } : {} })
  const context = vm.createContext({
    URL, Response, Date,
    self: { location: { origin: 'https://danz.example' }, addEventListener: (event, fn) => listeners.set(event, fn) },
    caches: { open: async () => ({ match: async () => cached, delete: async () => { removed = true } }) },
  })
  new vm.Script(source).runInContext(context)
  let response
  listeners.get('fetch')({ request: { method: 'GET', url: 'https://danz.example/danz/offline-media/user/album/image' }, respondWith: (promise) => { response = promise } })
  return { response: await response, removed }
}

test('service worker serves a recent private thumbnail offline', async () => {
  const result = await privateMediaResponse(new Date(Date.now() - 60_000).toISOString())
  assert.equal(result.response.status, 200)
  assert.equal(result.removed, false)
})

for (const [name, savedAt] of [
  ['expired', new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString()],
  ['missing timestamp', null],
  ['invalid timestamp', 'invalid'],
  ['future timestamp', new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()],
]) {
  test(`service worker deletes a private thumbnail with ${name}`, async () => {
    const result = await privateMediaResponse(savedAt)
    assert.equal(result.response.status, 404)
    assert.equal(result.response.headers.get('Cache-Control'), 'no-store')
    assert.equal(result.removed, true)
  })
}

async function offlineSyncHarness() {
  const stored = new Map()
  const thumbnails = new Map()
  const timers = []
  const authListeners = new Set()
  let effect
  const h = {
    fetchResponse: async () => new Response('thumbnail', { headers: { 'Content-Type': 'image/jpeg' } }),
    beforePut: async () => {},
    beforeKeys: null,
    tableResult: () => null,
  }
  const cache = {
    async keys() {
      const barrier = h.beforeKeys; h.beforeKeys = null
      if (barrier) await barrier.promise
      return [...thumbnails.keys()].map((url) => new Request(url))
    },
    async put(request, response) { await h.beforePut(request); thumbnails.set(request.url, response) },
    async delete(request) { return thumbnails.delete(request.url) },
  }
  const window = {
    caches: {}, location: { origin: 'https://danz.example' },
    localStorage: {
      get length() { return stored.size },
      key: (index) => [...stored.keys()][index],
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
    setTimeout: (fn) => { timers.push(fn); return timers.length },
    setInterval: () => 0, clearTimeout() {}, clearInterval() {},
    addEventListener() {}, removeEventListener() {},
  }
  const shared = { window, caches: { open: async () => cache }, URL, Request, Response, Headers, navigator: { onLine: true }, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } }
  const compileModule = async (path, imports = {}) => {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    const compiled = await transformWithEsbuild(source, path, { format: 'cjs', sourcemap: false })
    const module = { exports: {} }
    new vm.Script(compiled.code).runInContext(vm.createContext({ ...shared, fetch: (...args) => h.fetchResponse(...args), module, exports: module.exports, require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected import ${name}`)
      return imports[name]
    } }))
    return module.exports
  }
  h.offline = await compileModule('../src/lib/offlineCache.js')
  const album = { id: 'album', event_id: 'event', storage_path: 'album/image.jpg', storage_provider: 'supabase', event: { id: 'event', title: 'event' } }
  const supabase = {
    auth: { onAuthStateChange: (fn) => { authListeners.add(fn); return { data: { subscription: { unsubscribe: () => authListeners.delete(fn) } } } } },
    from: (table) => {
      const query = {
        select() { return query }, order() { return query }, limit() { return query }, gte() { return query }, eq() { return query }, in() { return query },
        then(resolve, reject) {
          return Promise.resolve(h.tableResult(table) || { data: table === 'event_albums' ? [album] : [] }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const component = await compileModule('../src/components/OfflineDataSync.jsx', {
    react: { useEffect: (fn) => { effect = fn }, useRef: (value) => ({ current: value }) },
    '../lib/supabase.js': { supabase },
    '../lib/offlineCache.js': h.offline,
    '../lib/mediaStorage.js': { resolvePrivateMediaBatch: async (items) => new Map(items.map((item) => [item.id, 'https://private.example/image.jpg'])) },
    '../hooks/useOnlineStatus.js': () => true,
  })
  h.mount = (id = 'user') => {
    component.default({ userId: id })
    const cleanup = effect()
    return { cleanup, start: () => timers.shift()() }
  }
  h.emit = (next) => authListeners.forEach((fn) => fn(next ? 'SIGNED_IN' : 'SIGNED_OUT', next))
  h.stored = stored; h.thumbnails = thumbnails
  h.flush = async () => { for (let index = 0; index < 30; index += 1) await Promise.resolve() }
  return h
}

test('logout during a thumbnail download cannot recreate purged media or text copies', async () => {
  const h = await offlineSyncHarness()
  const download = deferred()
  let fetching = false
  h.fetchResponse = () => { fetching = true; return download.promise }
  const sync = h.mount()
  const running = sync.start()
  await h.flush()
  assert.equal(fetching, true)
  assert.ok(h.stored.size > 0, 'sync reached a stage after its first text writes')
  h.offline.clearOfflineData('user')
  // Deliberately defer both the auth callback and React cleanup: clearing the
  // local cache alone must invalidate the in-flight synchronization.
  download.resolve(new Response('private thumbnail'))
  await running; await h.flush()
  assert.equal([...h.stored.keys()].filter((key) => key.startsWith('danz-offline-v2:')).length, 0)
  assert.equal(h.thumbnails.size, 0)
  sync.cleanup()
})

test('logout while cache.put is pending cleans only the old write and preserves a later login for the same user', async () => {
  const h = await offlineSyncHarness()
  const oldWrite = deferred()
  let oldRequest
  h.beforePut = async (request) => {
    if (!oldRequest) { oldRequest = request; await oldWrite.promise }
  }
  const oldSync = h.mount()
  const oldRunning = oldSync.start()
  await h.flush()
  assert.ok(oldRequest, 'old session has already started cache.put')

  // Delay the logout purge's key enumeration until the next login has written.
  const purge = deferred()
  h.beforeKeys = purge
  h.offline.clearOfflineData('user')
  h.emit(null)
  oldSync.cleanup()
  await h.flush()
  const newSync = h.mount()
  await newSync.start()
  const newKeys = [...h.thumbnails.keys()]
  assert.equal(newKeys.length, 1)
  assert.notEqual(newKeys[0], oldRequest.url)
  const newText = h.offline.readOfflineData('user', 'albums')
  assert.ok(newText?.length)

  purge.resolve(); await h.flush()
  assert.equal(h.thumbnails.has(newKeys[0]), true, 'delayed purge keeps the new epoch')
  oldWrite.resolve(); await oldRunning; await h.flush()
  assert.deepEqual([...h.thumbnails.keys()], newKeys, 'stale cache.put removes only its unique old key')
  assert.equal(h.offline.readOfflineData('user', 'albums')[0].offline_thumb, newText[0].offline_thumb)
  newSync.cleanup()
})

test('logout during questionnaire loading cannot restore purged text after the response arrives', async () => {
  const h = await offlineSyncHarness()
  const answers = deferred()
  h.tableResult = (table) => table === 'polls' ? { data: [{ id: 'poll', poll_type: 'questionnaire' }] } : table === 'poll_question_answers' ? answers.promise : null
  const sync = h.mount()
  const running = sync.start()
  await h.flush()
  assert.ok(h.stored.size > 0)
  h.offline.clearOfflineData('user')
  h.emit(null)
  answers.resolve({ data: [{ answer_text: 'private answer' }] })
  await running; await h.flush()
  assert.equal([...h.stored.keys()].filter((key) => key.startsWith('danz-offline-v2:')).length, 0)
  assert.equal(h.thumbnails.size, 0)
  sync.cleanup()
})
