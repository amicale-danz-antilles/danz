import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const STAGING_ID = "40438228-8e2d-4872-9c00-17cc7ccfdd4a";
const rootConfig = readFileSync(new URL("../../../wrangler.toml", import.meta.url), "utf8");
const workerConfig = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

function validate(config, source) {
  assert.match(config, /^name\s*=\s*"danz-api"$/m, source);
  assert.match(config, /^\[previews\]$/m, source);
  assert.match(config, /^\[\[previews\.d1_databases\]\]$/m, source);
  assert.match(config, /^\[\[d1_databases\]\]$/m, source);
  assert.equal((config.match(/database_id\s*=/g) || []).length, 2, source);
  assert.equal((config.match(new RegExp(STAGING_ID, "g")) || []).length, 2, source);
  assert.equal((config.match(/database_name\s*=\s*"danz-staging"/g) || []).length, 2, source);
  assert.doesNotMatch(config, /danz-prod|axewfeanyfxkzercafen|danz-amicale/, source);
}

test("les configurations Wrangler normales et previews sont exclusivement sur D1 staging", () => {
  validate(rootConfig, "root");
  validate(workerConfig, "worker");
  assert.match(rootConfig, /^main\s*=\s*"workers\/danz-api\/src\/index\.mjs"$/m);
  assert.match(workerConfig, /^main\s*=\s*"src\/index\.mjs"$/m);
});
