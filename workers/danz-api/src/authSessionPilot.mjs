/**
 * DANZ — validation de session PROTOTYPE.
 * Aucun endpoint ne l'utilise actuellement. Pas de création d'utilisateur,
 * de session ou de mot de passe. Ne pas brancher en production sans revue.
 */
export const PILOT_COOKIE_NAME = "__Host-danz_session";
const DANZ_ORIGIN = "https://amicale-danz-antilles.github.io";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function extractSingleCookie(request, name) {
  const raw = request?.headers?.get("Cookie");
  if (!raw || raw.length > 8192) return null;
  const values = raw.split(";").map(item => item.trim())
    .filter(item => item.startsWith(name + "="))
    .map(item => item.slice(name.length + 1));
  return values.length === 1 ? values[0] : null;
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeHexEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== 64 || b.length !== 64) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < 64; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Renvoie uniquement un principal serveur; les droits restent verifies dans
 * authorizationPilot.mjs. En cas de doute => null.
 *
 * requireCsrf doit etre utilise pour toute operation modifiant l'etat.
 * Cette fonction n'est appelee par aucune route publique pour le moment.
 */
export async function verifyPilotSession(request, env, { nowIso = new Date().toISOString(), requireCsrf = false } = {}) {
  if (!env?.DB || !request?.headers || typeof nowIso !== "string") return null;
  const token = extractSingleCookie(request, PILOT_COOKIE_NAME);
  if (!token || !TOKEN_PATTERN.test(token)) return null;

  // Les methodes non idempotentes exigent systematiquement un CSRF valide,
  // meme si un futur appelant oublie requireCsrf.
  const safeMethod = request.method === "GET" || request.method === "HEAD";
  const csrfRequired = requireCsrf || !safeMethod;
  if (csrfRequired && request.headers.get("Origin") !== DANZ_ORIGIN) return null;
  const csrf = csrfRequired ? request.headers.get("X-DANZ-CSRF") : null;
  if (csrfRequired && (!csrf || !TOKEN_PATTERN.test(csrf))) return null;

  try {
    const digest = await sha256Hex(token);
    const row = await env.DB.prepare(
      `SELECT a.id AS user_id, a.role, a.active, a.is_treasurer, a.household_id,
              a.security_version AS current_version,
              s.account_security_version AS session_version, s.csrf_digest
       FROM stg_auth_sessions AS s
       JOIN stg_auth_accounts AS a ON a.id = s.account_id
       WHERE s.session_digest = ?1
         AND s.revoked_at IS NULL
         AND s.expires_at > ?2
       LIMIT 1`
    ).bind(digest, nowIso).first();

    if (!row || row.active !== 1 || row.session_version !== row.current_version) return null;
    if (row.role !== "admin" && row.role !== "member") return null;

    if (csrfRequired) {
      const csrfDigest = await sha256Hex(csrf);
      if (!constantTimeHexEqual(csrfDigest, row.csrf_digest)) return null;
    }

    return Object.freeze({
      id: row.user_id,
      role: row.role,
      active: true,
      is_treasurer: row.role === "admin" && row.is_treasurer === 1,
      household_id: row.household_id ?? null,
    });
  } catch (_) {
    // Aucun message interne D1 ou information sensible transmis au client.
    return null;
  }
}

/**
 * Deconnexion de la session courante uniquement.
 * La requete DOIT etre POST avec Origin et X-DANZ-CSRF valides.
 * Fonction pilote non exposee par une route du Worker.
 */
export async function revokePilotSession(request, env, { nowIso = new Date().toISOString() } = {}) {
  if (request?.method !== "POST" || !env?.DB) return false;
  const principal = await verifyPilotSession(request, env, { nowIso, requireCsrf: true });
  if (!principal) return false;
  const token = extractSingleCookie(request, PILOT_COOKIE_NAME);
  if (!token || !TOKEN_PATTERN.test(token)) return false;
  try {
    const digest = await sha256Hex(token);
    const result = await env.DB.prepare(
      "UPDATE stg_auth_sessions SET revoked_at = ?1 WHERE session_digest = ?2 AND revoked_at IS NULL"
    ).bind(nowIso, digest).run();
    return Number(result?.meta?.changes) === 1;
  } catch (_) {
    return false;
  }
}
