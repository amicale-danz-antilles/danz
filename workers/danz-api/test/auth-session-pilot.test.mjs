import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { authorizePilot } from "../src/authorizationPilot.mjs";
import { PILOT_COOKIE_NAME, verifyPilotSession } from "../src/authSessionPilot.mjs";

const finance = readFileSync(new URL("../migrations/0001_staging_finance_pilot.sql", import.meta.url), "utf8");
const auth = readFileSync(new URL("../migrations/0002_staging_identity_pilot.sql", import.meta.url), "utf8");
const nowIso = "2026-11-19T10:00:00.000Z";
const origin = "https://amicale-danz-antilles.github.io";
const token = Buffer.alloc(32, 17).toString("base64url");
const csrf = Buffer.alloc(32, 19).toString("base64url");
const digest = str => createHash("sha256").update(str).digest("hex");

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(finance);
  db.exec(auth);
  db.prepare("INSERT INTO stg_households(id,code) VALUES (?,?)").run("test-household-a", "TEST-A");
  db.prepare("INSERT INTO stg_households(id,code) VALUES (?,?)").run("test-household-b", "TEST-B");
  db.prepare(`INSERT INTO stg_auth_accounts
    (id,email_normalized,role,active,is_treasurer,household_id)
    VALUES (?,?,?,?,?,?)`
  ).run("test-user", "test-user@example.invalid", "member", 1, 0, "test-household-a");
  db.prepare(`INSERT INTO stg_auth_sessions
    (id,account_id,session_digest,csrf_digest,account_security_version,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?)`
  ).run("test-session", "test-user", digest(token), digest(csrf), 1,
    "2026-11-19T09:00:00.000Z", "2026-11-19T12:00:00.000Z");
  const env = { DB: { prepare(sql) {
    return { bind(...args) { return { async first() { return db.prepare(sql).get(...args); } }; } };
  } } };
  return {db,env};
}

const req = (cookie = token, options = {}) => new Request("https://danz-api.example.workers.dev/private", {
  method: options.method || "GET",
  headers: {
    ...(cookie ? { Cookie: `${PILOT_COOKIE_NAME}=${cookie}` } : {}),
    ...(options.origin ? { Origin: options.origin } : {}),
    ...(options.csrf ? { "X-DANZ-CSRF": options.csrf } : {}),
  },
});

test("le schema d'identite comporte trois tables vides avant les donnees fictives", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(finance);
  db.exec(auth);
  for (const name of ["stg_auth_accounts", "stg_auth_sessions", "stg_auth_audit"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n, 0);
  }
  db.close();
});

test("l'identite rejette l'escalade tresorier membre et les e-mails dupliques", () => {
  const {db} = setup();
  assert.throws(() => db.prepare(
    "INSERT INTO stg_auth_accounts(id,email_normalized,role,active,is_treasurer) VALUES('bad','bad@example.invalid','member',1,1)"
  ).run());
  assert.throws(() => db.prepare(
    "INSERT INTO stg_auth_accounts(id,email_normalized,role,active,is_treasurer) VALUES('bad','TEST-USER@example.invalid','member',1,0)"
  ).run());
  assert.throws(() => db.prepare(
    "INSERT INTO stg_auth_accounts(id,email_normalized,role,active,is_treasurer) VALUES('bad','bad@example.invalid','superadmin',1,0)"
  ).run());
  db.close();
});

test("un cookie de session valide obtient uniquement le profil confirme par D1", async () => {
  const {db,env} = setup();
  const principal = await verifyPilotSession(req(), env, {nowIso});
  assert.deepEqual(principal, {
    id: "test-user", role: "member", active: true,
    is_treasurer: false, household_id: "test-household-a",
  });
  assert.equal(authorizePilot({
    sessionVerified: true, principal, action: "household.read",
    resource: {household_id: "test-household-b"},
  }), false);
  assert.equal(authorizePilot({
    sessionVerified: true, principal, action: "household.read",
    resource: {household_id: "test-household-a"},
  }), true);
  assert.equal(authorizePilot({
    sessionVerified: true, principal, action: "treasury_entry.read",
  }), false);
  db.close();
});

test("sessions absentes, falsifiees, expirees, revoquees ou dupliquees refusees", async () => {
  const {db,env} = setup();
  assert.equal(await verifyPilotSession(req(null), env, {nowIso}), null);
  assert.equal(await verifyPilotSession(req(Buffer.alloc(32, 18).toString("base64url")), env, {nowIso}), null);
  assert.equal(await verifyPilotSession(req("invalid"), env, {nowIso}), null);
  assert.equal(await verifyPilotSession(req(), env, {nowIso: "2026-11-19T13:00:00.000Z"}), null);
  assert.equal(await verifyPilotSession(new Request("https://danz-api.example.workers.dev/private", {
    headers: {Cookie: `${PILOT_COOKIE_NAME}=${token}; ${PILOT_COOKIE_NAME}=${token}`},
  }), env, {nowIso}), null);
  db.prepare("UPDATE stg_auth_sessions SET revoked_at=? WHERE id='test-session'").run(nowIso);
  assert.equal(await verifyPilotSession(req(), env, {nowIso}), null);
  db.close();
});

test("changer role, droits ou etat du compte invalide immediatement les sessions", async () => {
  const {db,env} = setup();
  assert.ok(await verifyPilotSession(req(), env, {nowIso}));
  db.prepare("UPDATE stg_auth_accounts SET role='admin', is_treasurer=1 WHERE id='test-user'").run();
  assert.equal(db.prepare("SELECT security_version AS v FROM stg_auth_accounts WHERE id='test-user'").get().v, 2);
  assert.equal(await verifyPilotSession(req(), env, {nowIso}), null);
  db.close();
});

test("CSRF obligatoire pour une mutation, meme avec un cookie valide", async () => {
  const {db,env} = setup();
  const opts = {nowIso,requireCsrf:true};
  assert.equal(await verifyPilotSession(req(token, {method:"POST"}), env, opts), null);
  assert.equal(await verifyPilotSession(req(token, {method:"POST",origin:"https://evil.invalid",csrf}), env, opts), null);
  assert.equal(await verifyPilotSession(req(token, {method:"POST",origin,csrf:"fake"}), env, opts), null);
  assert.ok(await verifyPilotSession(req(token, {method:"POST",origin,csrf}), env, opts));
  db.close();
});

test("tokens mal formes et base indisponible echouent sans exposition d'erreur", async () => {
  const {db,env} = setup();
  assert.equal(await verifyPilotSession(req(), {}, {nowIso}), null);
  assert.equal(await verifyPilotSession(req(), {DB:{prepare(){throw new Error("sensitive");}}}, {nowIso}), null);
  assert.equal(await verifyPilotSession(req(Buffer.alloc(32, 3).toString("hex")), env, {nowIso}), null);
  db.close();
});
