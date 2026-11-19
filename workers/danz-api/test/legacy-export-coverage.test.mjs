import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = JSON.parse(readFileSync(new URL("../migration/source-contract.json",import.meta.url),"utf8"));
const coverage = JSON.parse(readFileSync(new URL("../migration/legacy-export-coverage.json",import.meta.url),"utf8"));
const sourceNames = new Set(contract.tables.map(row=>row.name));

test("export administratif historique explicitement incomplet",()=>{
  assert.equal(contract.tables.length,36);
  assert.equal(coverage.exportedPublicTables.length,16);
  assert.equal(coverage.missingPublicTables.length,20);
  assert.equal(coverage.safeAsStandaloneBackup,false);
  assert.equal(coverage.binaryAssetsIncluded,false);
  assert.ok(coverage.exportedPublicTables.every(name=>sourceNames.has(name)));
  assert.ok(coverage.missingPublicTables.every(name=>sourceNames.has(name)));
  assert.equal(new Set([...coverage.exportedPublicTables,...coverage.missingPublicTables]).size,36);
});

test("l'export historique ne protege pas les ecritures de tresorerie ni les foyers",()=>{
  for(const name of ["treasury_entries","treasury_opening","treasury_transfers",
    "household_payments","household_payment_allocations","household_charges",
    "membership_subscriptions","push_subscriptions"]){
    assert.ok(coverage.missingPublicTables.includes(name),name);
  }
});
