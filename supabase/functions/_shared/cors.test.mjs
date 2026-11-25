import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { Script, createContext } from "node:vm";
import test from "node:test";
import { corsHeaders, isAllowedOrigin } from "./cors.mjs";

const allowed = [
  "https://amicale-danz-antilles.github.io",
  "https://danz-antilles.pages.dev",
];
const denied = [
  "https://evil.example",
  "https://danz-antilles.pages.dev.evil.example",
  "https://preview.danz-antilles.pages.dev",
  "http://danz-antilles.pages.dev",
  "null",
  "http://localhost:5173",
];
const functions = [
  "approve-membership-request",
  "admin-user-management",
  "admin-data-export",
  "admin-system-status",
  "request-membership",
];

test("CORS accepts only the two production origins and existing requests without Origin", () => {
  for (const origin of allowed) {
    assert.equal(isAllowedOrigin(origin), true);
    assert.equal(corsHeaders(origin)["Access-Control-Allow-Origin"], origin);
    assert.equal(corsHeaders(origin).Vary, "Origin");
  }
  assert.equal(isAllowedOrigin(null), true);
  assert.equal(corsHeaders(null)["Access-Control-Allow-Origin"], undefined);
  for (const origin of denied) {
    assert.equal(isAllowedOrigin(origin), false);
    assert.equal(corsHeaders(origin)["Access-Control-Allow-Origin"], undefined);
  }
});

for (const slug of functions) {
  test(`${slug}: preflight and rejection happen before any Supabase client or environment access`, async () => {
    let handler;
    let environmentReads = 0;
    let clientCalls = 0;
    const source = await readFile(new URL(`../${slug}/index.ts`, import.meta.url), "utf8");
    const context = createContext({
      Deno: {
        serve(fn) { handler = fn; },
        env: { get() { environmentReads += 1; throw new Error("Unexpected environment access"); } },
      },
      createClient() { clientCalls += 1; throw new Error("Unexpected Supabase access"); },
      corsHeaders,
      isAllowedOrigin,
      Request,
      Response,
    });
    const executable = stripTypeScriptTypes(source.replace(/^import .*;\n/gm, ""), { mode: "strip" });
    new Script(executable, { filename: slug + "/index.ts" }).runInContext(context);
    assert.equal(typeof handler, "function");
    for (const origin of allowed) {
      const preflight = await handler(new Request("https://function.example", {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
      }));
      assert.equal(preflight.status, 200);
      assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
      assert.equal(preflight.headers.get("Vary"), "Origin");
      const unauthenticated = await handler(new Request("https://function.example", {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}",
      }));
      assert.equal(unauthenticated.status, 400);
      assert.equal(unauthenticated.headers.get("Access-Control-Allow-Origin"), origin);
      const body = await unauthenticated.json();
      assert.match(body.error, slug === "request-membership" ? /Nom et prénom requis/ : /Authentification requise/);
    }
    for (const origin of denied) {
      for (const method of ["OPTIONS", "POST"]) {
        const response = await handler(new Request("https://function.example", { method, headers: { Origin: origin } }));
        assert.equal(response.status, 403);
        assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
      }
    }
    assert.equal(environmentReads, 0);
    assert.equal(clientCalls, 0);
  });
}
