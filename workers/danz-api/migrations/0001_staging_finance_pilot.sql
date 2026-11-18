-- DANZ D1 : prototype de schema financier pour tests exclusivement.
-- Base cible: danz-staging. Ne pas appliquer a une base de production.
-- Ne contient aucune donnee reelle ni aucun identifiant d'adherent.
-- Tables stg_* volontairement distinctes du futur schema metier.
-- Les controles d'acces et les operations financieres atomiques restent A CONCEVOIR.

CREATE TABLE IF NOT EXISTS stg_households (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS stg_events (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  starts_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS stg_household_charges (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES stg_households(id) ON DELETE RESTRICT,
  event_id TEXT REFERENCES stg_events(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK(category IN ('membership','meal','drinks','activity','adjustment','other')),
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS stg_household_payments (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES stg_households(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
  method TEXT NOT NULL CHECK(method IN ('bank_transfer','cash','unassigned')),
  status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','declared','confirmed','cancelled')),
  reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS stg_household_payment_allocations (
  payment_id TEXT NOT NULL REFERENCES stg_household_payments(id) ON DELETE RESTRICT,
  charge_id TEXT NOT NULL REFERENCES stg_household_charges(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
  PRIMARY KEY(payment_id, charge_id)
);

-- Une allocation ne peut depasser ni le montant paye ni le montant du.
-- Les allocations d'un paiement doivent concerner le meme foyer.
CREATE TRIGGER IF NOT EXISTS stg_allocations_check_insert
BEFORE INSERT ON stg_household_payment_allocations
BEGIN
  SELECT CASE WHEN (SELECT status FROM stg_household_payments WHERE id=NEW.payment_id)='cancelled'
    OR (SELECT status FROM stg_household_charges WHERE id=NEW.charge_id)='cancelled'
    THEN RAISE(ABORT,'allocation_cancelled_source') END;
  SELECT CASE WHEN (
    SELECT p.household_id <> c.household_id
    FROM stg_household_payments p, stg_household_charges c
    WHERE p.id = NEW.payment_id AND c.id = NEW.charge_id
  ) THEN RAISE(ABORT,'allocation_household_mismatch') END;
  SELECT CASE WHEN NEW.amount_cents + COALESCE((
    SELECT SUM(amount_cents) FROM stg_household_payment_allocations
    WHERE payment_id=NEW.payment_id
  ),0) > (SELECT amount_cents FROM stg_household_payments WHERE id=NEW.payment_id)
    THEN RAISE(ABORT,'allocation_exceeds_payment') END;
  SELECT CASE WHEN NEW.amount_cents + COALESCE((
    SELECT SUM(amount_cents) FROM stg_household_payment_allocations
    WHERE charge_id=NEW.charge_id
  ),0) > (SELECT amount_cents FROM stg_household_charges WHERE id=NEW.charge_id)
    THEN RAISE(ABORT,'allocation_exceeds_charge') END;
END;

CREATE TRIGGER IF NOT EXISTS stg_allocations_check_update
BEFORE UPDATE ON stg_household_payment_allocations
BEGIN
  SELECT CASE WHEN (SELECT status FROM stg_household_payments WHERE id=NEW.payment_id)='cancelled'
    OR (SELECT status FROM stg_household_charges WHERE id=NEW.charge_id)='cancelled'
    THEN RAISE(ABORT,'allocation_cancelled_source') END;
  SELECT CASE WHEN (
    SELECT p.household_id <> c.household_id
    FROM stg_household_payments p, stg_household_charges c
    WHERE p.id=NEW.payment_id AND c.id=NEW.charge_id
  ) THEN RAISE(ABORT,'allocation_household_mismatch') END;
  SELECT CASE WHEN NEW.amount_cents + COALESCE((
    SELECT SUM(amount_cents) FROM stg_household_payment_allocations
    WHERE payment_id=NEW.payment_id AND NOT (payment_id=OLD.payment_id AND charge_id=OLD.charge_id)
  ),0) > (SELECT amount_cents FROM stg_household_payments WHERE id=NEW.payment_id)
    THEN RAISE(ABORT,'allocation_exceeds_payment') END;
  SELECT CASE WHEN NEW.amount_cents + COALESCE((
    SELECT SUM(amount_cents) FROM stg_household_payment_allocations
    WHERE charge_id=NEW.charge_id AND NOT (payment_id=OLD.payment_id AND charge_id=OLD.charge_id)
  ),0) > (SELECT amount_cents FROM stg_household_charges WHERE id=NEW.charge_id)
    THEN RAISE(ABORT,'allocation_exceeds_charge') END;
END;

-- Une modification de paiement ou de charge ne peut invalider des allocations existantes.
CREATE TRIGGER IF NOT EXISTS stg_payment_update_guard
BEFORE UPDATE OF household_id, amount_cents, status ON stg_household_payments
BEGIN
  SELECT CASE WHEN NEW.amount_cents < COALESCE((
    SELECT SUM(amount_cents) FROM stg_household_payment_allocations WHERE payment_id=OLD.id
  ),0) THEN RAISE(ABORT,'payment_below_allocated') END;
  SELECT CASE WHEN NEW.household_id <> OLD.household_id AND EXISTS (
    SELECT 1 FROM stg_household_payment_allocations WHERE payment_id=OLD.id
  ) THEN RAISE(ABORT,'payment_household_change_with_allocations') END;
  SELECT CASE WHEN NEW.status='cancelled' AND EXISTS (
    SELECT 1 FROM stg_household_payment_allocations WHERE payment_id=OLD.id
  ) THEN RAISE(ABORT,'payment_cancelled_with_allocations') END;
END;

CREATE TRIGGER IF NOT EXISTS stg_charge_update_guard
BEFORE UPDATE OF household_id, amount_cents, status ON stg_household_charges
BEGIN
  SELECT CASE WHEN NEW.amount_cents < COALESCE((
    SELECT SUM(amount_cents) FROM stg_household_payment_allocations WHERE charge_id=OLD.id
  ),0) THEN RAISE(ABORT,'charge_below_allocated') END;
  SELECT CASE WHEN NEW.household_id <> OLD.household_id AND EXISTS (
    SELECT 1 FROM stg_household_payment_allocations WHERE charge_id=OLD.id
  ) THEN RAISE(ABORT,'charge_household_change_with_allocations') END;
  SELECT CASE WHEN NEW.status='cancelled' AND EXISTS (
    SELECT 1 FROM stg_household_payment_allocations WHERE charge_id=OLD.id
  ) THEN RAISE(ABORT,'charge_cancelled_with_allocations') END;
END;

CREATE TABLE IF NOT EXISTS stg_treasury_opening (
  id INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK(id=1),
  bank_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(bank_cents)='integer'),
  cash_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(cash_cents)='integer'),
  unassigned_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(unassigned_cents)='integer'),
  as_of TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stg_treasury_entries (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('income','expense','reimbursement','cash_adjustment')),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
  label TEXT NOT NULL,
  event_id TEXT REFERENCES stg_events(id) ON DELETE RESTRICT,
  household_payment_id TEXT UNIQUE REFERENCES stg_household_payments(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('bank_transfer','card','cash','personal_advance','unassigned')),
  reimbursement_method TEXT CHECK(reimbursement_method IN ('cash','bank_transfer','card')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled','cancelled')),
  occurred_at TEXT NOT NULL,
  settled_at TEXT,
  cancelled_at TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK(needs_review IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS stg_treasury_transfers (
  id TEXT PRIMARY KEY NOT NULL,
  from_account TEXT NOT NULL CHECK(from_account IN ('bank','cash')),
  to_account TEXT NOT NULL CHECK(to_account IN ('bank','cash')),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
  occurred_at TEXT NOT NULL,
  cancelled_at TEXT,
  CHECK(from_account <> to_account)
);

CREATE INDEX IF NOT EXISTS stg_household_charges_household_idx ON stg_household_charges(household_id, status);
CREATE INDEX IF NOT EXISTS stg_household_payments_household_idx ON stg_household_payments(household_id, status);
CREATE INDEX IF NOT EXISTS stg_allocations_charge_idx ON stg_household_payment_allocations(charge_id);
CREATE INDEX IF NOT EXISTS stg_treasury_entries_date_idx ON stg_treasury_entries(occurred_at, status);
CREATE INDEX IF NOT EXISTS stg_treasury_entries_event_idx ON stg_treasury_entries(event_id);
CREATE INDEX IF NOT EXISTS stg_treasury_transfers_date_idx ON stg_treasury_transfers(occurred_at);
