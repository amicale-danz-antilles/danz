const SUPABASE_ORIGIN = 'https://axewfeanyfxkzercafen.supabase.co'
const SITE_ORIGIN = 'https://amicale-danz-antilles.github.io'

const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, range',
  'Access-Control-Expose-Headers': 'content-range, range, x-total-count',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (origin && origin !== SITE_ORIGIN) {
      return json({ error: 'Origin not allowed' }, 403)
    }

    if (url.pathname === '/health') {
      const started = Date.now()
      try {
        const upstream = await fetch(`${SUPABASE_ORIGIN}/auth/v1/health`, {
          headers: { 'User-Agent': 'DANZ-Network-Relay/1.0' },
          cf: { cacheTtl: 0, cacheEverything: false },
        })
        return json({
          ok: upstream.ok,
          relay: true,
          upstream_status: upstream.status,
          latency_ms: Date.now() - started,
        }, upstream.ok ? 200 : 502)
      } catch {
        return json({ ok: false, relay: true, upstream_status: null, latency_ms: Date.now() - started }, 502)
      }
    }

    // Seules les API nécessaires à l'application sont relayées.
    const allowedPrefixes = ['/auth/v1/', '/rest/v1/', '/functions/v1/', '/storage/v1/']
    if (!allowedPrefixes.some(prefix => url.pathname.startsWith(prefix))) {
      return json({ error: 'Route not allowed' }, 404)
    }

    const target = new URL(url.pathname + url.search, SUPABASE_ORIGIN)
    const headers = new Headers(request.headers)
    headers.delete('host')
    headers.delete('cf-connecting-ip')
    headers.delete('cf-ipcountry')
    headers.delete('cf-ray')
    headers.delete('x-forwarded-for')
    headers.delete('x-forwarded-proto')

    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    }

    try {
      const upstream = await fetch(target.toString(), init)
      const responseHeaders = new Headers(upstream.headers)
      responseHeaders.set('Access-Control-Allow-Origin', SITE_ORIGIN)
      responseHeaders.set('Access-Control-Expose-Headers', 'content-range, range, x-total-count')
      responseHeaders.set('Vary', 'Origin')
      responseHeaders.delete('content-length')
      responseHeaders.delete('transfer-encoding')

      const location = responseHeaders.get('location')
      if (location?.startsWith(SUPABASE_ORIGIN)) {
        responseHeaders.set('location', location.replace(SUPABASE_ORIGIN, url.origin))
      }

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      })
    } catch {
      return json({ error: 'Upstream unavailable' }, 502)
    }
  },
}
