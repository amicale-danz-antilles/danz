import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.mjs";
import {
  PILOT_OPENING, PILOT_ENTRIES, PILOT_TRANSFERS, PILOT_AS_OF,
  FINANCE_PILOT_SQL, EXPECTED_PILOT_BALANCES,
} from "../src/financePilot.mjs";
import { ledgerBalances } from "../../../src/lib/treasuryLedger.js";

const expected = EXPECTED_PILOT_BALANCES;
const base = "https://danz-api.example.workers.dev";

test("les soldes fictifs correspondent au grand livre actuellement utilise par DANZ", () => {
  const balances = ledgerBalances(PILOT_OPENING, PILOT_ENTRIES, PILOT_TRANSFERS, new Date(PILOT_AS_OF));
  assert.deepEqual(balances, { bank: 17000, cash: 2000, unassigned: 400 });
  assert.equal(balances.bank + balances.cash + balances.unassigned, expected.total_cents);
});

test("SQLite calcule les memes soldes a partir de VALUES fictifs, sans table ni ecriture", () => {
  const db = new DatabaseSync(":memory:");
  const result = db.prepare(FINANCE_PILOT_SQL).get();
  assert.deepEqual({ ...result }, { ...expected });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n, 0);
  db.close();
});

test("GET /finance-check verifie les resultats D1 et n'envoie aucune donnee reelle", async () => {
  let query = "";
  const env = { DB: { prepare(sql) {
    query = sql;
    return { async first() { return { ...expected }; } };
  } } };
  const response = await worker.fetch(new Request(base + "/finance-check"), env);
  assert.equal(response.status, 200);
  assert.equal(query, FINANCE_PILOT_SQL);
  assert.deepEqual(await response.json(), {
    ok: true,
    stage: "synthetic-finance-check",
    readonly: true,
    data: "synthetic-only",
    balances: expected,
  });
});

test("GET /finance-check detecte un calcul inexact", async () => {
  const env = { DB: { prepare() {
    return { async first() { return { ...expected, cash_cents: 1 }; } };
  } } };
  const response = await worker.fetch(new Request(base + "/finance-check"), env);
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.ok, false);
});

test("GET /finance-check masque les erreurs D1", async () => {
  const env = { DB: { prepare() { throw new Error("private-error"); } } };
  const response = await worker.fetch(new Request(base + "/finance-check"), env);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-error/);
});
