/**
 * DANZ — matrice d'autorisation PILOTE, indépendante du site en production.
 *
 * IMPORTANT:
 * - Principals are not created from client JSON, headers, or self-signed tokens.
 * - A future session verifier MUST construct principal from server-side records.
 * - This module does not authenticate users or grant access to any live route.
 * - No real user, financial or military data is read or stored.
 * - Unknown action or missing session => deny by default.
 */

const HOUSEHOLD_READ_ACTIONS = new Set([
  "household.read",
  "household_member.read",
  "household_charge.read",
  "household_payment.read",
  "household_allocation.read",
  "membership_subscription.read",
]);

const ADMIN_ACTIONS = new Set([
  "household.manage",
  "household_member.manage",
  "household_charge.manage",
  "household_payment.manage",
  "household_allocation.manage",
  "membership_subscription.manage",
  "membership_request.read",
  "membership_request.manage",
  "event.manage",
]);

const TREASURER_ACTIONS = new Set([
  "treasury_entry.read",
  "treasury_entry.manage",
  "treasury_opening.read",
  "treasury_opening.manage",
  "treasury_transfer.read",
  "treasury_transfer.manage",
]);

/**
 * @param {object} options
 * @param {boolean} options.sessionVerified - true only after server-side session validation
 * @param {object} options.principal - fetched from DB, never from request payload
 * @param {string} options.action - one allowlisted action
 * @param {object} [options.resource] - DB row or server-validated lookup data
 * @returns {boolean}
 */
export function authorizePilot({ sessionVerified = false, principal, action, resource } = {}) {
  if (sessionVerified !== true || !principal || principal.active !== true ||
      typeof principal.id !== "string" || principal.id.length === 0 ||
      typeof action !== "string") return false;

  const isAdmin = principal.role === "admin";
  const isTreasurer = isAdmin && principal.is_treasurer === true;
  const belongsToHousehold =
    typeof principal.household_id === "string" && principal.household_id.length > 0 &&
    typeof resource?.household_id === "string" &&
    resource.household_id === principal.household_id;

  if (action === "profile.read") {
    return isAdmin || (typeof resource?.id === "string" && resource.id === principal.id);
  }
  if (ADMIN_ACTIONS.has(action)) return isAdmin;
  if (TREASURER_ACTIONS.has(action)) return isTreasurer;
  if (HOUSEHOLD_READ_ACTIONS.has(action)) return isAdmin || belongsToHousehold;

  // Unknown actions and future data domains are blocked until reviewed.
  return false;
}
