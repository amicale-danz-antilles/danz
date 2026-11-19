import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const base = "https://danz-api.example.workers.dev";
const names = ["stg_auth_accounts", "stg_auth_sessions", "stg_auth_audit"];
const tr = "stg_auth_security_version_guard";

function envFor({ tables = names, trigger = true, count = 0 } = {}) {
  const sqls = [];
  const env = { DB: { prepare(sql) {
    sqls.push(sql);
    if (sql.includes("type='table'")) return { async all() { return { results: tables.map(name => ({ name })) }; } };
    if (sql.includes("type='trigger'")) return { async all() { return { results: trigger ? [{ name: tr }] : [] }; } };
    return { async first() { return { n: count }; } };
  } } };
  return { env, sqls };
}

test("le diagnostic de l'identite pilote accepte une base sans tables", async () => {
  const {env} = envFor({tables:[],trigger:false});
  const response = await worker.fetch(new Request(base + "/auth-schema-status"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok:false, stage:"auth-schema-check", database:"danz-staging",
    tablesExpected:3, tablesPresent:0, triggersExpected:1, triggersPresent:0,
    empty:false,readonly:true,
  });
});

test("le diagnostic accepte 3 tables et un declencheur vides", async () => {
  const {env,sqls} = envFor();
  const response = await worker.fetch(new Request(base + "/auth-schema-status"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok:true, stage:"auth-schema-check", database:"danz-staging",
    tablesExpected:3, tablesPresent:3, triggersExpected:1, triggersPresent:1,
    empty:true,readonly:true,
  });
  assert.equal(sqls.length,5);
  assert.ok(sqls.every(sql=>sql.startsWith("SELECT ")));
});

test("le diagnostic n'expose aucun contenu d'identite meme si les tables sont remplies", async () => {
  const {env} = envFor({count:1});
  const response = await worker.fetch(new Request(base + "/auth-schema-status"),env);
  const data = await response.json();
  assert.equal(data.ok,false);
  assert.equal(data.empty,false);
  assert.equal(JSON.stringify(data).includes("@"),false);
});

test("le diagnostic ne divulgue pas les details d'erreurs D1", async () => {
  const env = {DB:{prepare(){throw new Error("confidential diagnostic");}}};
  const response = await worker.fetch(new Request(base + "/auth-schema-status"),env);
  assert.equal(response.status,503);
  assert.doesNotMatch(await response.text(),/confidential diagnostic/);
});
