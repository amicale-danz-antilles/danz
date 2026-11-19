import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const base = "https://danz-api.example.workers.dev";
const origin = "https://amicale-danz-antilles.github.io";

test("GET /session-probe autorise uniquement le site DANZ et annonce les credentials", async () => {
  const response = await worker.fetch(new Request(base + "/session-probe?step=set", {
    headers: { Origin: origin },
  }), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
  const cookie = response.headers.get("Set-Cookie") || "";
  for (const flag of ["HttpOnly", "Secure", "SameSite=None", "Path=/session-probe", "Max-Age=60"]) {
    assert.ok(cookie.includes(flag), flag);
  }
  assert.deepEqual(await response.json(), { ok: true, step: "set", personalData: false });
});

test("GET /session-probe ne renvoie aucune valeur de cookie", async () => {
  const response = await worker.fetch(new Request(base + "/session-probe?step=check", {
    headers: { Origin: origin, Cookie: "danz_probe=1" },
  }), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, step: "check", cookieReceived: true, personalData: false,
  });
  const absent = await worker.fetch(new Request(base + "/session-probe?step=check", {
    headers: { Origin: origin },
  }), {});
  assert.equal((await absent.json()).cookieReceived, false);
});

test("GET /session-probe est inaccessible aux origines non autorisees", async () => {
  for (const site of [null, "https://example.org"]) {
    const headers = site ? { Origin: site } : {};
    const response = await worker.fetch(new Request(base + "/session-probe?step=set", { headers }), {});
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
  }
});

test("GET /session-probe supprime le cookie sans session", async () => {
  const response = await worker.fetch(new Request(base + "/session-probe?step=clear", {
    headers: { Origin: origin },
  }), {});
  assert.equal(response.status, 200);
  assert.ok((response.headers.get("Set-Cookie") || "").includes("Max-Age=0"));
  assert.equal((await response.json()).personalData, false);
});

test("GET /session-probe n'expose aucune donnee ni route d'inscription", async () => {
  const response = await worker.fetch(new Request(base + "/session-probe?step=login", {
    headers: { Origin: origin },
  }), {});
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.ok(!("user" in result));
});
