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
