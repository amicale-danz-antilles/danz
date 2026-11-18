// API de diagnostic, isolee de DANZ en production.
// Aucune donnee membre, aucun compte, aucun acces Supabase, D1 ou R2.
const DANZ_ORIGIN = "https://amicale-danz-antilles.github.io";

function responseHeaders(request) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  });

  if (request.headers.get("Origin") === DANZ_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", DANZ_ORIGIN);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = responseHeaders(request);
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      // Interdire les preflights provenant d'autres sites.
      if (request.headers.get("Origin") !== DANZ_ORIGIN) {
        return json({ ok: false, error: "origin_not_allowed" }, 403, headers);
      }
      if (url.pathname !== "/" && url.pathname !== "/connectivity-check") {
        return json({ ok: false, error: "not_found" }, 404, headers);
      }
      return new Response(null, { status: 204, headers });
    }

    if (method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({
        ok: true,
        service: "DANZ - Test Cloudflare",
        stage: "connectivity-only",
        method: "GET",
      }, 200, headers);
    }

    if (method === "POST" && url.pathname === "/connectivity-check") {
      if (request.headers.get("Origin") !== DANZ_ORIGIN) {
        return json({ ok: false, error: "origin_not_allowed" }, 403, headers);
      }
      // Ne pas analyser, enregistrer ou retransmettre le corps de la requete.
      return json({
        ok: true,
        service: "DANZ - Test Cloudflare",
        stage: "connectivity-only",
        method: "POST",
      }, 200, headers);
    }

    return json({ ok: false, error: "not_found" }, 404, headers);
  },
};
