export default {
  async fetch() {
    return new Response(JSON.stringify({
      ok: true,
      service: 'Amicale DANZ - test de compatibilité réseau Cloudflare',
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  },
}
