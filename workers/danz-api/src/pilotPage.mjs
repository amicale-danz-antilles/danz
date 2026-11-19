// Diagnostics publics de préproduction. Aucun accès Supabase, aucune identité.
export const PILOT_HTML = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>DANZ · Test de préproduction</title>
<style>
:root{font:17px/1.6 system-ui,sans-serif;color:#183242;background:#f1f5f3}body{margin:0}main{max-width:760px;margin:auto;padding:40px 22px}header{border-top:5px solid #22785a;padding-top:20px}small{font-weight:700;letter-spacing:.07em;color:#22785a}h1{font-size:clamp(1.9rem,5vw,2.7rem);line-height:1.15;margin:12px 0}section{background:white;border:1px solid #d3dfda;border-radius:14px;padding:22px;margin:20px 0}.notice{background:#fff5dc;border-color:#d9b866}button{background:#175d46;color:white;border:0;border-radius:8px;padding:13px 22px;font:inherit;font-weight:650;cursor:pointer}button:disabled{opacity:.6;cursor:wait}li{margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}a{color:#175d46}footer{font-size:14px;color:#465f6a}.status{font-weight:700}button:focus-visible,a:focus-visible{outline:3px solid #b57213;outline-offset:4px}
</style><script src="/pilot.js" defer></script></head>
<body><main><header><small>AMICALE DANZ ANTILLES · PRÉPRODUCTION</small><h1>Tester l’accès depuis votre poste professionnel</h1><p>Ce pilote utilise uniquement des scénarios fictifs. Le site des adhérents reste sur son environnement actuel.</p></header>
<section class="notice"><strong>Migration réelle : NO-GO</strong><p>Aucune connexion adhérent n’est disponible ici. N’entrez aucun mot de passe, nom, document ou montant réel. La sauvegarde complète restaurée et la parité fonctionnelle restent à valider.</p></section>
<section><h2>Contrôle de compatibilité</h2><p>Le test vérifie l’accès au serveur, la liaison à D1, le schéma pilote, un calcul fictif et un cookie de diagnostic valable une minute. Il ne modifie aucune table.</p><button id="run" type="button">Lancer les tests</button><p id="status" class="status" role="status" aria-live="polite">Prêt à tester.</p><ol id="results"></ol><details><summary>Résultat à transmettre au trésorier</summary><pre id="report">Aucun test exécuté.</pre></details></section>
<footer>La réussite confirme uniquement les diagnostics affichés sur cet appareil et ce réseau. Elle ne prouve ni la connexion des adhérents, ni la conservation des données, ni une autorisation informatique. En cas de blocage, ne désactivez aucune protection du poste.</footer></main></body></html>`;

export const PILOT_JS = `
const button = document.getElementById('run');
const status = document.getElementById('status');
const list = document.getElementById('results');
const report = document.getElementById('report');
const checks = [
 ['Serveur Cloudflare', '/health', d => d.ok === true],
 ['Liaison D1 de test', '/db-health', d => d.ok === true && d.readonly === true && d.database === 'danz-staging'],
 ['Schéma financier pilote vide (8 tables)', '/schema-status', d => d.ok === true && d.empty === true && d.tablesPresent === 8 && d.triggersPresent === 4],
 ['Schéma d’identité pilote vide (3 tables)', '/auth-schema-status', d => d.ok === true && d.empty === true && d.tablesPresent === 3 && d.triggersPresent === 1],
 ['Calcul fictif au centime', '/finance-check', d => d.ok === true && d.data === 'synthetic-only' && d.balances?.bank_cents === 17000 && d.balances?.cash_cents === 2000 && d.balances?.unassigned_cents === 400 && d.balances?.total_cents === 19400],
 ['Requête POST de diagnostic', '/pilot/connectivity-check', d => d.ok === true && d.syntheticOnly === true, 'POST'],
];
async function read(path, method = 'GET') {
 const response = await fetch(path, {method, credentials:'same-origin', cache:'no-store', redirect:'error', signal:AbortSignal.timeout(12000)});
 if (!response.ok) throw new Error('diagnostic_failed');
 return response.json();
}
button.addEventListener('click', async () => {
 button.disabled = true; list.replaceChildren(); status.textContent = 'Tests en cours…';
 const outcomes = [];
 function add(label, ok) { const li = document.createElement('li'); li.textContent = (ok ? '✓ ' : '⚠ ') + label + (ok ? ' : réussi' : ' : échec ou indisponible'); list.appendChild(li); outcomes.push({test:label, ok}); }
 try {
  for (const [label,path,validate,method] of checks) { try { add(label, validate(await read(path, method))); } catch { add(label, false); } }
  let cookieOK = false;
  try { await read('/pilot/probe/set','POST'); cookieOK = (await read('/pilot/probe/check','POST')).cookieReceived === true; }
  catch {} finally { try { await read('/pilot/probe/clear','POST'); } catch {} }
  add('Cookie temporaire de diagnostic (même site)', cookieOK);
  const ok = outcomes.every(item => item.ok);
  status.textContent = ok ? 'Diagnostics réussis. La migration réelle reste bloquée.' : 'Au moins un diagnostic reste à vérifier.';
  report.textContent = JSON.stringify({pilotVersion:'2026-11-19-v1', testedAt:new Date().toISOString(), mode:'synthetic-only', tests:outcomes, realMigration:'NO-GO', memberLogin:'unavailable'}, null, 2);
 } finally { button.disabled = false; }
});`;

function reply(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...extra,
  }});
}

export function pilotResponse(request) {
  const url = new URL(request.url);
  if (request.method === 'GET' && ['/pilot', '/pilot/', '/pilot.js'].includes(url.pathname)) {
    const script = url.pathname === '/pilot.js';
    return new Response(script ? PILOT_JS : PILOT_HTML, {headers: {
      'Content-Type': script ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    }});
  }
  if (!['/pilot/connectivity-check', '/pilot/probe/set', '/pilot/probe/check', '/pilot/probe/clear'].includes(url.pathname)) return null;
  if (request.method !== 'POST') return reply({ok:false,error:'method_not_allowed'},405, {'Allow':'POST'});
  if (request.headers.get('Origin') !== url.origin) return reply({ok:false,error:'origin_not_allowed'},403);
  // Ne lit jamais le corps, et ne crée ni compte, ni session, ni ligne D1.
  const result = {ok:true, syntheticOnly:true, personalData:false};
  if (url.pathname === '/pilot/probe/check') result.cookieReceived = (request.headers.get('Cookie') || '').split(';').some(c => c.trim() === '__Host-danz_pilot=1');
  const extra = {};
  if (url.pathname === '/pilot/probe/set') extra['Set-Cookie'] = '__Host-danz_pilot=1; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Strict';
  if (url.pathname === '/pilot/probe/clear') extra['Set-Cookie'] = '__Host-danz_pilot=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';
  return reply(result,200,extra);
}
