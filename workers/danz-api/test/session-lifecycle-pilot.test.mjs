import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PILOT_COOKIE_NAME, verifyPilotSession, revokePilotSession } from "../src/authSessionPilot.mjs";
import {
  makePilotSessionMaterial, clearPilotSessionCookie, PILOT_SESSION_TTL_SECONDS,
} from "../src/sessionLifecyclePilot.mjs";

const financialSchema = readFileSync(new URL("../migrations/0001_staging_finance_pilot.sql", import.meta.url), "utf8");
const authSchema = readFileSync(new URL("../migrations/0002_staging_identity_pilot.sql", import.meta.url), "utf8");
const NOW = "2026-11-19T10:00:00.000Z";
const ORIGIN = "https://amicale-danz-antilles.github.io";
const hash = value => createHash("sha256").update(value).digest("hex");

function openEnvironment() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(financialSchema);
  db.exec(authSchema);
  db.prepare("INSERT INTO stg_auth_accounts (id,email_normalized,role,active) VALUES (?,?,?,?)")
    .run("fake-account-1", "fake@example.invalid", "member", 1);
  const env = { DB: { prepare(sql) {
    return { bind(...values) {
      return {
        async first() { return db.prepare(sql).get(...values); },
        async run() {
          const change = db.prepare(sql).run(...values);
          return { meta: { changes: change.changes } };
        },
      };
    } };
  } } };
  return {db,env};
}

function requestFor(token, {method="GET", origin, csrf} = {}) {
  return new Request("https://danz-api.example.workers.dev/session", {
    method,
    headers: {
      Cookie: `${PILOT_COOKIE_NAME}=${token}`,
      ...(origin ? { Origin: origin } : {}),
      ...(csrf ? { "X-DANZ-CSRF": csrf } : {}),
    },
  });
}

test("les tokens aleatoires 256 bits ne sont pas stockes en clair", async () => {
  const a = await makePilotSessionMaterial({nowIso:NOW});
  const b = await makePilotSessionMaterial({nowIso:NOW});
  assert.match(a.sessionToken,/^[A-Za-z0-9_-]{43}$/);
  assert.match(a.csrfToken,/^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.sessionToken,b.sessionToken);
  assert.notEqual(a.csrfToken,b.csrfToken);
  assert.notEqual(a.sessionToken,a.csrfToken);
  assert.equal(a.dbRecord.session_digest,hash(a.sessionToken));
  assert.equal(a.dbRecord.csrf_digest,hash(a.csrfToken));
  assert.ok(!JSON.stringify(a.dbRecord).includes(a.sessionToken));
  assert.ok(!JSON.stringify(a.dbRecord).includes(a.csrfToken));
  assert.equal(a.dbRecord.expires_at,"2026-11-19T11:00:00.000Z");
  assert.equal(PILOT_SESSION_TTL_SECONDS,3600);
});

test("les cookies sont partitionnes, HttpOnly, et effaces a la deconnexion", async () => {
  const {cookieHeader} = await makePilotSessionMaterial({nowIso:NOW});
  for (const part of [`${PILOT_COOKIE_NAME}=`, "Path=/", "Max-Age=3600", "HttpOnly", "Secure", "SameSite=None", "Partitioned"]) {
    assert.ok(cookieHeader.includes(part),part);
  }
  const clear = clearPilotSessionCookie();
  for (const part of [`${PILOT_COOKIE_NAME}=`, "Max-Age=0", "HttpOnly", "Secure", "SameSite=None", "Partitioned"]) {
    assert.ok(clear.includes(part),part);
  }
  await assert.rejects(makePilotSessionMaterial({nowIso:"invalid"}),/invalid_session_start/);
});

test("session fictive: emise, validee, puis revoquee sans affecter des utilisateurs reels", async () => {
  const {db,env} = openEnvironment();
  const tokens = await makePilotSessionMaterial({nowIso:NOW});
  const {dbRecord} = tokens;
  db.prepare(`INSERT INTO stg_auth_sessions
    (id,account_id,session_digest,csrf_digest,account_security_version,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    dbRecord.id, "fake-account-1", dbRecord.session_digest,
    dbRecord.csrf_digest, 1, dbRecord.created_at, dbRecord.expires_at,
  );

  assert.ok(await verifyPilotSession(requestFor(tokens.sessionToken),env,{nowIso:NOW}));
  // Protection automatique : POST exige le CSRF, meme sans requireCsrf:true.
  assert.equal(await verifyPilotSession(
    requestFor(tokens.sessionToken,{method:"POST"}),env,{nowIso:NOW},
  ),null);
  assert.equal(await revokePilotSession(
    requestFor(tokens.sessionToken,{method:"POST",origin:ORIGIN,csrf:"bad"}),env,{nowIso:NOW},
  ),false);
  const verifiedForMutation = await verifyPilotSession(
    requestFor(tokens.sessionToken,{method:"POST",origin:ORIGIN,csrf:tokens.csrfToken}),
    env,{nowIso:NOW},
  );
  assert.equal(verifiedForMutation?.id,"fake-account-1");
  assert.equal(await revokePilotSession(
    requestFor(tokens.sessionToken,{method:"POST",origin:ORIGIN,csrf:tokens.csrfToken}),
    env,{nowIso:NOW},
  ),true);
  assert.equal(await verifyPilotSession(requestFor(tokens.sessionToken),env,{nowIso:NOW}),null);
  assert.equal(await revokePilotSession(
    requestFor(tokens.sessionToken,{method:"POST",origin:ORIGIN,csrf:tokens.csrfToken}),
    env,{nowIso:NOW},
  ),false);
  db.close();
});

test("deconnexion refusee avec mauvaise methode, mauvaise origine, mauvais cookie ou base absente", async () => {
  const {db,env} = openEnvironment();
  const tokens = await makePilotSessionMaterial({nowIso:NOW});
  assert.equal(await revokePilotSession(requestFor(tokens.sessionToken),env,{nowIso:NOW}),false);
  assert.equal(await revokePilotSession(requestFor(tokens.sessionToken,{method:"POST",origin:"https://other.example",csrf:tokens.csrfToken}),env,{nowIso:NOW}),false);
  assert.equal(await revokePilotSession(requestFor(tokens.sessionToken,{method:"POST",origin:ORIGIN,csrf:tokens.csrfToken}),{}, {nowIso:NOW}),false);
  db.close();
});
