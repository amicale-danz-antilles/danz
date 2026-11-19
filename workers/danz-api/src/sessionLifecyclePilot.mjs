/**
 * DANZ — generateur de jetons de session fictifs, SANS connexion active.
 * La verification des identifiants et anti-abus devra preceder toute
 * creation de session en base. Aucun endpoint public n'utilise ce code.
 */
import { PILOT_COOKIE_NAME } from "./authSessionPilot.mjs";

export const PILOT_SESSION_TTL_SECONDS = 60 * 60;

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

export function clearPilotSessionCookie() {
  return `${PILOT_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`;
}

/**
 * Pour tests : produire des tokens aleatoires et uniquement leurs empreintes.
 * Le futur flux de connexion devra d'abord etablir l'identite cote serveur.
 * ATTENTION : n'insere pas automatiquement en D1 et n'envoie aucune reponse.
 */
export async function makePilotSessionMaterial({ nowIso = new Date().toISOString() } = {}) {
  const parsed = Date.parse(nowIso);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== nowIso) {
    throw new Error("invalid_session_start");
  }
  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(parsed + PILOT_SESSION_TTL_SECONDS * 1000).toISOString();
  const sessionDigest = await sha256Hex(sessionToken);
  const csrfDigest = await sha256Hex(csrfToken);
  return {
    sessionToken,
    csrfToken,
    dbRecord: {
      id: crypto.randomUUID(),
      session_digest: sessionDigest,
      csrf_digest: csrfDigest,
      created_at: nowIso,
      expires_at: expiresAt,
    },
    cookieHeader: `${PILOT_COOKIE_NAME}=${sessionToken}; Path=/; Max-Age=${PILOT_SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=None; Partitioned`,
  };
}
