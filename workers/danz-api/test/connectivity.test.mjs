import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const base = "https://danz-api.example.workers.dev";
const origin = "https://amicale-danz-antilles.github.io";

test("GET /health retourne une reponse sans donnees personnelles", async () => {
  const response = await worker.fetch(new Request(base + "/health"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "DANZ - Test Cloudflare",
    stage: "connectivity-only",
    method: "GET",
  });
});

test("OPTIONS accepte uniquement l'origine publique de DANZ", async () => {
  const response = await worker.fetch(new Request(base + "/connectivity-check", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.match(response.headers.get("Access-Control-Allow-Methods"), /POST/);
});

test("OPTIONS refuse les origines inconnues", async () => {
  const response = await worker.fetch(new Request(base + "/connectivity-check", {
    method: "OPTIONS",
    headers: { Origin: "https://example.com" },
  }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("POST /connectivity-check accepte DANZ sans lire ni renvoyer le corps", async () => {
  const response = await worker.fetch(new Request(base + "/connectivity-check", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ test: true }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.method, "POST");
  assert.equal(result.test, undefined);
});

test("POST refuse une origine etrangere", async () => {
  const response = await worker.fetch(new Request(base + "/connectivity-check", {
    method: "POST",
    headers: { Origin: "https://example.com" },
  }));
  assert.equal(response.status, 403);
});

test("Aucune route de gestion des adherents n'existe", async () => {
  const response = await worker.fetch(new Request(base + "/members"));
  assert.equal(response.status, 404);
});

test("GET /db-health signale proprement une liaison D1 absente", async () => {
  const response = await worker.fetch(new Request(base + "/db-health"), {});
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.equal(data.database, "danz-staging");
});

test("GET /db-health n'exécute que SELECT 1 sur la base de test", async () => {
  let executed = "";
  const env = { DB: { prepare(sql) {
    executed = sql;
    return { async first() { return { reachable: 1 }; } };
  } } };
  const response = await worker.fetch(new Request(base + "/db-health"), env);
  assert.equal(response.status, 200);
  assert.equal(executed, "SELECT 1 AS reachable");
  assert.deepEqual(await response.json(), {
    ok: true,
    database: "danz-staging",
    stage: "binding-test",
    readonly: true,
  });
});

test("GET /db-health ne divulgue pas les erreurs de base", async () => {
  const env = { DB: { prepare() { throw new Error("private database information"); } } };
  const response = await worker.fetch(new Request(base + "/db-health"), env);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private database information/);
});

test("GET /schema-status : aucun schema pilote dans D1", async () => {
  const queries = [];
  const env = { DB: { prepare(sql) {
    queries.push(sql);
    return { async all() { return { results: [] }; } };
  } } };
  const response = await worker.fetch(new Request(base + "/schema-status"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: false, database: "danz-staging", stage: "finance-schema-check",
    tablesExpected: 8, tablesPresent: 0, triggersExpected: 4,
    triggersPresent: 0, empty: false, readonly: true,
  });
  assert.equal(queries.length, 2);
  assert.ok(queries.every(sql => sql.startsWith("SELECT ")));
});

test("GET /schema-status : schema complet et tables vides", async () => {
  const tables = [
    "stg_households", "stg_events", "stg_household_charges",
    "stg_household_payments", "stg_household_payment_allocations",
    "stg_treasury_opening", "stg_treasury_entries", "stg_treasury_transfers",
  ];
  const triggers = [
    "stg_allocations_check_insert", "stg_allocations_check_update",
    "stg_payment_update_guard", "stg_charge_update_guard",
  ];
  const queries = [];
  const env = { DB: { prepare(sql) {
    queries.push(sql);
    if (sql.includes("type = 'table'")) return { async all() { return { results: tables.map(name => ({ name })) }; } };
    if (sql.includes("type = 'trigger'")) return { async all() { return { results: triggers.map(name => ({ name })) }; } };
    return { async first() { return { n: 0 }; } };
  } } };
  const response = await worker.fetch(new Request(base + "/schema-status"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, database: "danz-staging", stage: "finance-schema-check",
    tablesExpected: 8, tablesPresent: 8, triggersExpected: 4,
    triggersPresent: 4, empty: true, readonly: true,
  });
  assert.equal(queries.length, 10);
  assert.ok(queries.every(sql => sql.startsWith("SELECT ")));
});

test("GET /schema-status : signaler la presence de donnees sans les exposer", async () => {
  const tableNames = [
    "stg_households", "stg_events", "stg_household_charges",
    "stg_household_payments", "stg_household_payment_allocations",
    "stg_treasury_opening", "stg_treasury_entries", "stg_treasury_transfers",
  ];
  const triggers = [
    "stg_allocations_check_insert", "stg_allocations_check_update",
    "stg_payment_update_guard", "stg_charge_update_guard",
  ];
  const env = { DB: { prepare(sql) {
    if (sql.includes("type = 'table'")) return { async all() { return { results: tableNames.map(name => ({ name })) }; } };
    if (sql.includes("type = 'trigger'")) return { async all() { return { results: triggers.map(name => ({ name })) }; } };
    return { async first() { return { n: sql.includes("FROM stg_households") ? 1 : 0 }; } };
  } } };
  const response = await worker.fetch(new Request(base + "/schema-status"), env);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.empty, false);
  assert.equal(body.tablesPresent, 8);
  assert.equal(JSON.stringify(body).includes("stg_households"), false);
});

test("GET /schema-status : masquer les erreurs D1", async () => {
  const env = { DB: { prepare() { throw new Error("secret-schema-error"); } } };
  const response = await worker.fetch(new Request(base + "/schema-status"), env);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret-schema-error/);
});

test("GET /schema-status : erreur de comptage identifiee sans divulgation", async () => {
  const names = [
    "stg_households", "stg_events", "stg_household_charges",
    "stg_household_payments", "stg_household_payment_allocations",
    "stg_treasury_opening", "stg_treasury_entries", "stg_treasury_transfers",
  ];
  const triggers = [
    "stg_allocations_check_insert", "stg_allocations_check_update",
    "stg_payment_update_guard", "stg_charge_update_guard",
  ];
  const env = { DB: { prepare(sql) {
    if (sql.includes("type = 'table'")) return { async all() { return { results: names.map(name => ({ name })) }; } };
    if (sql.includes("type = 'trigger'")) return { async all() { return { results: triggers.map(name => ({ name })) }; } };
    return { async first() { throw new Error("private SQL detail"); } };
  } } };
  const response = await worker.fetch(new Request(base + "/schema-status"), env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false, stage: "finance-schema-check", reason: "query_failed", phase: "row-counts",
  });
});
