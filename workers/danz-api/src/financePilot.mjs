// Scenario de tresorerie 100 % fictif. Aucune lecture de donnees reelles.
// Permet de comparer les calculs SQLite D1 aux regles du grand livre actuel.
export const PILOT_OPENING = Object.freeze({
  bank_cents: 10000,
  cash_cents: 2000,
  unassigned_cents: 0,
  as_of: "2026-11-01T00:00:00Z",
});
export const PILOT_AS_OF = "2026-11-19T23:59:59Z";

export const PILOT_ENTRIES = Object.freeze([
  { kind: "income", amount_cents: 6000, payment_method: "bank_transfer", status: "settled", occurred_at: "2026-11-10T10:00:00Z" },
  { kind: "expense", amount_cents: 1500, payment_method: "cash", status: "settled", occurred_at: "2026-11-12T10:00:00Z" },
  { kind: "income", amount_cents: 2500, payment_method: "cash", status: "settled", occurred_at: "2026-11-13T10:00:00Z" },
  { kind: "income", amount_cents: 400, payment_method: "unassigned", status: "settled", occurred_at: "2026-11-15T10:00:00Z" },
  { kind: "income", amount_cents: 10000, payment_method: "card", status: "pending", occurred_at: "2026-11-14T10:00:00Z" },
  { kind: "income", amount_cents: 8000, payment_method: "unassigned", status: "cancelled", occurred_at: "2026-11-14T10:00:00Z" },
  { kind: "income", amount_cents: 7000, payment_method: "bank_transfer", status: "settled", occurred_at: "2026-10-01T10:00:00Z" },
  { kind: "income", amount_cents: 3000, payment_method: "card", status: "settled", occurred_at: "2026-12-01T10:00:00Z" },
]);

export const PILOT_TRANSFERS = Object.freeze([
  { from_account: "cash", to_account: "bank", amount_cents: 1000, occurred_at: "2026-11-15T12:00:00Z", cancelled_at: null },
  { from_account: "bank", to_account: "cash", amount_cents: 9999, occurred_at: "2026-11-15T12:00:00Z", cancelled_at: "2026-11-15T13:00:00Z" },
  { from_account: "bank", to_account: "cash", amount_cents: 3000, occurred_at: "2026-12-01T12:00:00Z", cancelled_at: null },
  { from_account: "cash", to_account: "bank", amount_cents: 100, occurred_at: "2026-10-10T12:00:00Z", cancelled_at: null },
]);

export const EXPECTED_PILOT_BALANCES = Object.freeze({
  bank_cents: 17000,
  cash_cents: 2000,
  unassigned_cents: 400,
  total_cents: 19400,
});

// Toute la requete reste en lecture seule : CTE VALUES et SELECT sans table utilisateur.
// Les chaines de dates sont ISO-8601 UTC et comparables lexicalement.
export const FINANCE_PILOT_SQL = `
WITH
  accounts(account, opening_cents) AS (
    VALUES ('bank', 10000), ('cash', 2000), ('unassigned', 0)
  ),
  entries(kind, amount_cents, payment_method, status, occurred_at) AS (
    VALUES
      ('income', 6000, 'bank_transfer', 'settled', '2026-11-10T10:00:00Z'),
      ('expense', 1500, 'cash', 'settled', '2026-11-12T10:00:00Z'),
      ('income', 2500, 'cash', 'settled', '2026-11-13T10:00:00Z'),
      ('income', 400, 'unassigned', 'settled', '2026-11-15T10:00:00Z'),
      ('income', 10000, 'card', 'pending', '2026-11-14T10:00:00Z'),
      ('income', 8000, 'unassigned', 'cancelled', '2026-11-14T10:00:00Z'),
      ('income', 7000, 'bank_transfer', 'settled', '2026-10-01T10:00:00Z'),
      ('income', 3000, 'card', 'settled', '2026-12-01T10:00:00Z')
  ),
  transfers(from_account, to_account, amount_cents, occurred_at, cancelled_at) AS (
    VALUES
      ('cash', 'bank', 1000, '2026-11-15T12:00:00Z', NULL),
      ('bank', 'cash', 9999, '2026-11-15T12:00:00Z', '2026-11-15T13:00:00Z'),
      ('bank', 'cash', 3000, '2026-12-01T12:00:00Z', NULL),
      ('cash', 'bank', 100, '2026-10-10T12:00:00Z', NULL)
  ),
  balances AS (
    SELECT
      a.account AS account,
      a.opening_cents
      + COALESCE((
          SELECT SUM(CASE WHEN e.kind = 'expense' THEN -e.amount_cents ELSE e.amount_cents END)
          FROM entries e
          WHERE e.status = 'settled'
            AND e.occurred_at > '2026-11-01T00:00:00Z'
            AND e.occurred_at <= '2026-11-19T23:59:59Z'
            AND (CASE
              WHEN e.payment_method = 'cash' THEN 'cash'
              WHEN e.payment_method = 'unassigned' THEN 'unassigned'
              ELSE 'bank'
            END) = a.account
        ), 0)
      + COALESCE((
          SELECT SUM(CASE WHEN t.from_account = a.account THEN -t.amount_cents ELSE t.amount_cents END)
          FROM transfers t
          WHERE t.cancelled_at IS NULL
            AND t.occurred_at > '2026-11-01T00:00:00Z'
            AND t.occurred_at <= '2026-11-19T23:59:59Z'
            AND (t.from_account = a.account OR t.to_account = a.account)
        ), 0)
      AS balance_cents
    FROM accounts a
  )
SELECT
  MAX(CASE WHEN account = 'bank' THEN balance_cents END) AS bank_cents,
  MAX(CASE WHEN account = 'cash' THEN balance_cents END) AS cash_cents,
  MAX(CASE WHEN account = 'unassigned' THEN balance_cents END) AS unassigned_cents,
  SUM(balance_cents) AS total_cents
FROM balances
`.trim();
