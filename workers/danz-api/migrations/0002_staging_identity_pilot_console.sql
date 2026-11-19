CREATE TABLE IF NOT EXISTS stg_auth_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email_normalized TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK(length(email_normalized) BETWEEN 3 AND 254
      AND email_normalized = lower(trim(email_normalized))
      AND instr(email_normalized, '@') > 1),
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'admin')),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1)),
  is_treasurer INTEGER NOT NULL DEFAULT 0 CHECK(is_treasurer IN (0, 1)),
  household_id TEXT REFERENCES stg_households(id) ON DELETE RESTRICT,
  security_version INTEGER NOT NULL DEFAULT 1 CHECK(security_version >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(is_treasurer = 0 OR role = 'admin')
);

CREATE TRIGGER IF NOT EXISTS stg_auth_security_version_guard
AFTER UPDATE OF role, active, is_treasurer, household_id ON stg_auth_accounts
WHEN NEW.role IS NOT OLD.role
   OR NEW.active IS NOT OLD.active
   OR NEW.is_treasurer IS NOT OLD.is_treasurer
   OR NEW.household_id IS NOT OLD.household_id
BEGIN
  UPDATE stg_auth_accounts
  SET security_version = OLD.security_version + 1
  WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS stg_auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES stg_auth_accounts(id) ON DELETE CASCADE,
  session_digest TEXT NOT NULL UNIQUE
    CHECK(length(session_digest) = 64 AND session_digest NOT GLOB '*[^0-9a-f]*'),
  csrf_digest TEXT NOT NULL
    CHECK(length(csrf_digest) = 64 AND csrf_digest NOT GLOB '*[^0-9a-f]*'),
  account_security_version INTEGER NOT NULL CHECK(account_security_version > 0),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK(expires_at > created_at),
  revoked_at TEXT,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS stg_auth_audit (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT REFERENCES stg_auth_accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN (
    'login_success', 'login_failure', 'logout',
    'session_revoked', 'account_disabled', 'role_changed'
  )),
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS stg_auth_sessions_account_idx
  ON stg_auth_sessions(account_id, expires_at);
CREATE INDEX IF NOT EXISTS stg_auth_sessions_expiration_idx
  ON stg_auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS stg_auth_audit_account_idx
  ON stg_auth_audit(account_id, occurred_at);
