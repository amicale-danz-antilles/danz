import { FINANCE_PILOT_SQL, EXPECTED_PILOT_BALANCES } from "./financePilot.mjs";
// API de diagnostic, isolee de DANZ en production.
// Aucun compte membre, mot de passe, acces Supabase ou R2.
// Seules des lectures de diagnostic sont effectuees sur la base D1 de test.
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
  async fetch(request, env) {
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

    // GET /db-health : test de liaison D1, strictement en lecture seule.
    // Ne renvoie ni schema, ni contenu, ni message de base de donnees.
    if (method === "GET" && url.pathname === "/db-health") {
      if (!env?.DB) {
        return json({ ok: false, database: "danz-staging", stage: "binding-test" }, 503, headers);
      }
      try {
        const result = await env.DB.prepare("SELECT 1 AS reachable").first();
        const ok = Number(result?.reachable) === 1;
        return json({ ok, database: "danz-staging", stage: "binding-test", readonly: true }, ok ? 200 : 503, headers);
      } catch (_) {
        return json({ ok: false, database: "danz-staging", stage: "binding-test" }, 503, headers);
      }
    }


    // Controle strictement en lecture seule du schema financier PILOTE.
    // N'expose ni lignes, ni donnees personnelles, ni SQL provenant de l'utilisateur.
    if (method === "GET" && url.pathname === "/schema-status") {
      if (!env?.DB) {
        return json({ ok: false, stage: "finance-schema-check", reason: "db_unavailable" }, 503, headers);
      }
      let phase = "introspection";
      try {
        const tableNames = [
          "stg_households", "stg_events", "stg_household_charges",
          "stg_household_payments", "stg_household_payment_allocations",
          "stg_treasury_opening", "stg_treasury_entries", "stg_treasury_transfers",
        ];
        const triggerNames = [
          "stg_allocations_check_insert", "stg_allocations_check_update",
          "stg_payment_update_guard", "stg_charge_update_guard",
        ];
        // Requetes sequentielles pour eviter les limites de certaines instances D1.
        const tablesResult = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'stg_%'"
        ).all();
        const triggersResult = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'stg_%'"
        ).all();
        const tables = new Set((tablesResult.results || []).map(item => item.name));
        const triggers = new Set((triggersResult.results || []).map(item => item.name));
        const tablesPresent = tableNames.filter(name => tables.has(name)).length;
        const triggersPresent = triggerNames.filter(name => triggers.has(name)).length;
        const schemaReady = tablesPresent === tableNames.length && triggersPresent === triggerNames.length;
        let empty = false;
        if (schemaReady) {
          // Noms fixes, definis dans le code. Pas de requete UNION ALL a huit termes.
          // Une seule lecture simple par table : aucun contenu retourne au navigateur.
          phase = "row-counts";
          empty = true;
          for (const name of tableNames) {
            const result = await env.DB.prepare("SELECT COUNT(*) AS n FROM " + name).first();
            if (Number(result?.n) !== 0) empty = false;
          }
        }
        return json({
          ok: schemaReady && empty,
          database: "danz-staging",
          stage: "finance-schema-check",
          tablesExpected: tableNames.length,
          tablesPresent,
          triggersExpected: triggerNames.length,
          triggersPresent,
          empty,
          readonly: true,
        }, 200, headers);
      } catch (_) {
        // Ne jamais exposer la cause interne ou des informations de la base.
        return json({ ok: false, stage: "finance-schema-check", reason: "query_failed", phase }, 503, headers);
      }
    }

    // Controle comptable D1 purement synthetique : aucune lecture/ecriture de tables.
    if (method === "GET" && url.pathname === "/finance-check") {
      if (!env?.DB) {
        return json({ ok: false, stage: "synthetic-finance-check", reason: "db_unavailable" }, 503, headers);
      }
      try {
        const result = await env.DB.prepare(FINANCE_PILOT_SQL).first();
        const fields = ["bank_cents", "cash_cents", "unassigned_cents", "total_cents"];
        const balances = Object.fromEntries(fields.map(field => [field, Number(result?.[field])]));
        const ok = fields.every(field =>
          Number.isSafeInteger(balances[field]) && balances[field] === EXPECTED_PILOT_BALANCES[field]
        );
        return json({
          ok, stage: "synthetic-finance-check", readonly: true,
          data: "synthetic-only", balances,
        }, ok ? 200 : 503, headers);
      } catch (_) {
        return json({ ok: false, stage: "synthetic-finance-check", reason: "query_failed" }, 503, headers);
      }
    }

    // Sonde ephemere de cookie cross-site, strictement sans identite ni session.
    // Sert UNIQUEMENT a valider la compatibilite github.io -> workers.dev.
    if (method === "GET" && url.pathname === "/session-probe") {
      if (request.headers.get("Origin") !== DANZ_ORIGIN) {
        return json({ ok: false, reason: "origin_not_allowed" }, 403, headers);
      }
      headers.set("Access-Control-Allow-Credentials", "true");
      const step = url.searchParams.get("step");
      if (step === "set") {
        headers.append("Set-Cookie",
          "__Host-danz_probe=1; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=None; Partitioned");
        return json({ ok: true, step: "set", personalData: false }, 200, headers);
      }
      if (step === "check") {
        const received = (request.headers.get("Cookie") || "")
          .split(";").some(value => value.trim() === "__Host-danz_probe=1");
        return json({ ok: true, step: "check", cookieReceived: received, personalData: false }, 200, headers);
      }
      if (step === "clear") {
        headers.append("Set-Cookie",
          "__Host-danz_probe=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned");
        return json({ ok: true, step: "clear", personalData: false }, 200, headers);
      }
      return json({ ok: false, error: "unknown_probe_step" }, 400, headers);
    }

    // Verification du schema d'identite pilote (lecture seule, aucune session reelle).
    if (method === "GET" && url.pathname === "/auth-schema-status") {
      if (!env?.DB) {
        return json({ ok: false, stage: "auth-schema-check", reason: "db_unavailable" }, 503, headers);
      }
      try {
        const tableNames = ["stg_auth_accounts", "stg_auth_sessions", "stg_auth_audit"];
        const triggerName = "stg_auth_security_version_guard";
        const [tablesResponse, triggersResponse] = await Promise.all([
          env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'stg_auth_%'").all(),
          env.DB.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='stg_auth_security_version_guard'").all(),
        ]);
        const foundTables = new Set((tablesResponse.results || []).map(row => row.name));
        const tablesPresent = tableNames.filter(name => foundTables.has(name)).length;
        const triggerPresent = (triggersResponse.results || []).some(row => row.name === triggerName);
        let empty = false;
        if (tablesPresent === tableNames.length && triggerPresent) {
          empty = true;
          for (const name of tableNames) {
            const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM " + name).first();
            if (Number(count?.n) !== 0) empty = false;
          }
        }
        return json({
          ok: tablesPresent === tableNames.length && triggerPresent && empty,
          stage: "auth-schema-check", database: "danz-staging",
          tablesExpected: 3, tablesPresent,
          triggersExpected: 1, triggersPresent: triggerPresent ? 1 : 0,
          empty, readonly: true,
        }, 200, headers);
      } catch (_) {
        return json({ ok: false, stage: "auth-schema-check", reason: "query_failed" }, 503, headers);
      }
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
