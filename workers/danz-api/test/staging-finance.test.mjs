import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const schema = readFileSync(
  new URL("../migrations/0001_staging_finance_pilot.sql", import.meta.url),
  "utf8",
);
function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(schema);
  return db;
}
function seedSynthetic(db) {
  for (const [id,code] of [["h1","DEMO-1"],["h2","DEMO-2"]]) {
    db.prepare("INSERT INTO stg_households(id,code) VALUES(?,?)").run(id,code);
  }
  const charge=db.prepare("INSERT INTO stg_household_charges(id,household_id,category,label,amount_cents) VALUES(?,?,?,?,?)");
  charge.run("c1","h1","membership","Fictif",6000);
  charge.run("c2","h1","meal","Fictif",2000);
  charge.run("c3","h2","meal","Fictif",2000);
  const payment=db.prepare("INSERT INTO stg_household_payments(id,household_id,amount_cents,method,reference) VALUES(?,?,?,?,?)");
  payment.run("p1","h1",6000,"cash","DEMO-1");
  payment.run("p2","h1",2000,"bank_transfer","DEMO-2");
}
test("schema pilote: 8 tables vides et references valides", () => {
  const db=openDb();
  const names=["stg_households","stg_events","stg_household_charges",
    "stg_household_payments","stg_household_payment_allocations",
    "stg_treasury_opening","stg_treasury_entries","stg_treasury_transfers"];
  for (const name of names) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n,0);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  db.close();
});
test("references et montants invalides rejetes", () => {
  const db=openDb();
  assert.throws(() => db.prepare("INSERT INTO stg_household_charges(id,household_id,category,label,amount_cents) VALUES('c','missing','meal','Fictif',10)").run());
  seedSynthetic(db);
  assert.throws(() => db.prepare("INSERT INTO stg_household_charges(id,household_id,category,label,amount_cents) VALUES('bad','h1','meal','Fictif',-1)").run());
  db.close();
});
test("allocations: pas de depassement ni de transfert entre foyers", () => {
  const db=openDb();seedSynthetic(db);
  const add=db.prepare("INSERT INTO stg_household_payment_allocations(payment_id,charge_id,amount_cents) VALUES(?,?,?)");
  add.run("p1","c1",5000);
  assert.throws(() => add.run("p1","c2",1500),/allocation_exceeds_payment/);
  assert.throws(() => add.run("p2","c1",1500),/allocation_exceeds_charge/);
  assert.throws(() => add.run("p1","c3",100),/allocation_household_mismatch/);
  db.close();
});
test("allocations: modification et annulation controlees", () => {
  const db=openDb();seedSynthetic(db);
  db.prepare("INSERT INTO stg_household_payment_allocations VALUES('p1','c1',5000)").run();
  assert.throws(() => db.prepare("UPDATE stg_household_payments SET amount_cents=100 WHERE id='p1'").run(),/payment_below_allocated/);
  assert.throws(() => db.prepare("UPDATE stg_household_charges SET household_id='h2' WHERE id='c1'").run(),/charge_household_change_with_allocations/);
  assert.throws(() => db.prepare("UPDATE stg_household_payments SET status='cancelled' WHERE id='p1'").run(),/payment_cancelled_with_allocations/);
  db.close();
});
test("transactions: une seule ecriture par paiement", () => {
  const db=openDb();seedSynthetic(db);
  const insert=db.prepare("INSERT INTO stg_treasury_entries(id,kind,amount_cents,label,household_payment_id,payment_method,occurred_at) VALUES(?,?,?,?,?,?,?)");
  insert.run("e1","income",6000,"Fictif","p1","cash","2026-11-18T10:00:00Z");
  assert.throws(() => insert.run("e2","income",6000,"Fictif","p1","cash","2026-11-18T10:01:00Z"));
  db.close();
});
test("transferts: comptes distincts et montant positif", () => {
  const db=openDb();
  const add=db.prepare("INSERT INTO stg_treasury_transfers(id,from_account,to_account,amount_cents,occurred_at) VALUES(?,?,?,?,?)");
  assert.throws(() => add.run("t1","bank","bank",100,"2026-11-18T10:00:00Z"));
  assert.throws(() => add.run("t2","bank","cash",0,"2026-11-18T10:00:00Z"));
  add.run("t3","bank","cash",100,"2026-11-18T10:00:00Z");
  db.close();
});
test("solde initial unique", () => {
  const db=openDb();
  const add=db.prepare("INSERT INTO stg_treasury_opening(id,bank_cents,cash_cents,as_of) VALUES(?,?,?,?)");
  add.run(1,10000,2000,"2026-11-01T00:00:00Z");
  assert.throws(() => add.run(2,0,0,"2026-11-01T00:00:00Z"));
  db.close();
});
