// Only public Supabase credentials may enter the downloadable frontend bundle.
const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = process.env
const fail = (message) => { throw new Error(`Configuration Cloudflare : ${message}`) }
if (!url || !key) fail('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont obligatoires.')
let parsed
try { parsed = new URL(url) } catch { fail('URL Supabase invalide.') }
if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
  fail('une URL Supabase HTTPS sans identifiants ni paramètres est requise.')
}
if (!key.startsWith('sb_publishable_')) {
  let claims
  try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()) } catch { /* rejected below */ }
  if (key.split('.').length !== 3 || claims?.role !== 'anon') {
    fail('seule une clé publique publishable ou anon est autorisée ; aucune clé secrète.')
  }
}
console.log('Configuration frontend Supabase publique vérifiée.')
