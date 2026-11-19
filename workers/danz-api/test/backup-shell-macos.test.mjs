import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const url=new URL("../migration/backup-postgres-private-macos.sh",import.meta.url);
const script=readFileSync(url,"utf8");

test("script macOS syntaxiquement valide, sans ecriture distante",()=>{
  const probe=spawnSync("bash",["-n",url.pathname],{encoding:"utf8"});
  assert.equal(probe.status,0,probe.stderr);
  assert.match(script,/pg_dump --format=custom --file=/);
  assert.match(script,/pg_restore --list/);
  assert.match(script,/verify-pgdump-toc\.mjs/);
  assert.doesNotMatch(script,/wrangler\s+d1\s+execute|supabase\s+db\s+reset|DROP TABLE|DELETE FROM/);
});

test("script refuse le mauvais projet et impose un volume declare chiffre",()=>{
  assert.match(script,/axewfeanyfxkzercafen/);
  assert.match(script,/CHIFFRE/);
  assert.match(script,/PGSSLMODE=require/);
  assert.match(script,/trap 'unset PGPASSWORD/);
  assert.match(script,/INCOMPLETE/);
  assert.match(script,/STOP MIGRATION/);
});

test("script ne contient aucun mot de passe ou URL de connexion fixe",()=>{
  assert.doesNotMatch(script,/:\/\/[A-Za-z0-9_-]+:[^ ]+@/);
  assert.doesNotMatch(script,/password\s*=\s*["'][^"'\n]+["']/i);
});
