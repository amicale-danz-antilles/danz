import test from "node:test";
import assert from "node:assert/strict";
import { authorizePilot } from "../src/authorizationPilot.mjs";

const activeMember = Object.freeze({ id: "TEST-member-1", active: true, role: "member", is_treasurer: false, household_id: "TEST-household-A" });
const activeAdmin = Object.freeze({ id: "TEST-admin-1", active: true, role: "admin", is_treasurer: false });
const activeTreasurer = Object.freeze({ id: "TEST-treasurer-1", active: true, role: "admin", is_treasurer: true });
const inactiveTreasurer = Object.freeze({ ...activeTreasurer, active: false });
const allowed = (principal, action, resource) => authorizePilot({ sessionVerified: true, principal, action, resource });

test("refus par defaut : utilisateur anonyme et session non validee", () => {
  assert.equal(authorizePilot({ action: "profile.read" }), false);
  assert.equal(authorizePilot({ principal: activeTreasurer, action: "treasury_entry.read" }), false);
  assert.equal(authorizePilot({ principal: activeTreasurer, sessionVerified: "true", action: "treasury_entry.read" }), false);
  assert.equal(authorizePilot({ principal: activeTreasurer, sessionVerified: true, action: "typo.something" }), false);
});

test("un compte desactive ne peut pas acceder a la tresorerie ou aux foyers", () => {
  assert.equal(allowed(inactiveTreasurer, "treasury_entry.read"), false);
  assert.equal(allowed({ ...activeMember, active: false }, "household.read", { household_id: activeMember.household_id }), false);
});

test("un membre ne voit que son profil", () => {
  assert.equal(allowed(activeMember, "profile.read", { id: activeMember.id }), true);
  assert.equal(allowed(activeMember, "profile.read", { id: "TEST-other" }), false);
  assert.equal(allowed(activeAdmin, "profile.read", { id: "TEST-other" }), true);
  assert.equal(allowed(activeMember, "profile.manage", { id: activeMember.id }), false);
});

test("un membre lit seulement son foyer, y compris les paiements et cotisations", () => {
  for (const action of [
    "household.read", "household_member.read", "household_charge.read",
    "household_payment.read", "household_allocation.read", "membership_subscription.read",
  ]) {
    assert.equal(allowed(activeMember, action, { household_id: "TEST-household-A" }), true, action);
    assert.equal(allowed(activeMember, action, { household_id: "TEST-household-B" }), false, action);
    assert.equal(allowed(activeMember, action), false, action);
    assert.equal(allowed(activeAdmin, action, { household_id: "TEST-household-B" }), true, action);
  }
});

test("un membre ne gere ni les membres, ni les paiements ni les evenements", () => {
  for (const action of [
    "membership_request.read", "membership_request.manage", "event.manage",
    "household.manage", "household_payment.manage", "household_charge.manage",
  ]) {
    assert.equal(allowed(activeMember, action), false, action);
    assert.equal(allowed(activeAdmin, action), true, action);
  }
});

test("la comptabilite reste reservee aux administrateurs tresoriers actifs", () => {
  for (const action of [
    "treasury_entry.read", "treasury_entry.manage", "treasury_opening.read",
    "treasury_opening.manage", "treasury_transfer.read", "treasury_transfer.manage",
  ]) {
    assert.equal(allowed(activeMember, action), false, action);
    assert.equal(allowed(activeAdmin, action), false, action);
    assert.equal(allowed(activeTreasurer, action), true, action);
    assert.equal(allowed(inactiveTreasurer, action), false, action);
  }
});

test("un role client falsifie ne suffit pas si la session n'est pas verifiee", () => {
  const untrustedClientPayload = { ...activeTreasurer, role: "admin", is_treasurer: true };
  assert.equal(authorizePilot({
    principal: untrustedClientPayload, action: "treasury_entry.manage", sessionVerified: false,
  }), false);
});

test("toutes les autres operations (e.g. contenu, auth et evenements publics) restent refusees", () => {
  for (const action of [
    "auth.login", "event.read", "news.manage", "gallery.read", "notification.send",
    "treasury_entry.delete", "", "random",
  ]) assert.equal(allowed(activeTreasurer, action), false, action);
});
