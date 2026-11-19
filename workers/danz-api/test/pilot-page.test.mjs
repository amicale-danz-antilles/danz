import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

const base = 'https://danz-api.example.workers.dev';
test('page pilote autonome, sans saisie ni domaine de production, avec CSP', async () => {
  const response = await worker.fetch(new Request(base + '/pilot'));
  assert.equal(response.status,200);
  assert.match(response.headers.get('Content-Type'),/text\/html/);
  assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'self'/);
  assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  const html = await response.text();
  assert.match(html,/Migration réelle : NO-GO/);
  assert.doesNotMatch(html,/<input|<form|https:\/\/|supabase\.co/i);
  const script = await worker.fetch(new Request(base + '/pilot.js'));
  assert.equal(script.status,200);
  const js = await script.text();
  assert.match(js,/credentials:'same-origin'/);
  assert.doesNotMatch(js,/localStorage|innerHTML|console\.|userAgent/);
});
test('routes pilote refusent les origines étrangères, absentes et les mauvaises méthodes', async () => {
  for (const path of ['/pilot/connectivity-check','/pilot/probe/set','/pilot/probe/check','/pilot/probe/clear']) {
    for (const origin of [null,'null','https://example.com','https://amicale-danz-antilles.github.io']) {
      const response = await worker.fetch(new Request(base + path,{method:'POST',headers:origin ? {Origin:origin} : {}}));
      assert.equal(response.status,403);
      assert.equal(response.headers.get('Set-Cookie'),null);
    }
    const response = await worker.fetch(new Request(base + path));
    assert.equal(response.status,405);
  }
});
test('diagnostic POST ignore le corps et ne touche pas D1', async () => {
  const env = {get DB() {throw new Error('must_not_access_D1');}};
  const response = await worker.fetch(new Request(base + '/pilot/connectivity-check',{method:'POST',headers:{Origin:base},body:'NE_PAS_JOURNALISER'}),env);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,syntheticOnly:true,personalData:false});
});
test('cookie pilote court, sécurisé, séparé des sessions, puis supprimé', async () => {
  const call = (step,cookie) => worker.fetch(new Request(base + '/pilot/probe/' + step,{method:'POST',headers:{Origin:base,...(cookie ? {Cookie:cookie} : {})}}));
  const set = await call('set');
  assert.equal(set.status,200);
  const cookie = set.headers.get('Set-Cookie');
  for (const attribute of ['__Host-danz_pilot=1','Max-Age=60','HttpOnly','Secure','SameSite=Strict','Path=/']) assert.ok(cookie.includes(attribute));
  assert.equal((await (await call('check','__Host-danz_pilot=1')).json()).cookieReceived,true);
  assert.equal((await (await call('check','__Host-danz_session=1')).json()).cookieReceived,false);
  assert.match((await call('clear')).headers.get('Set-Cookie'),/Max-Age=0/);
});
