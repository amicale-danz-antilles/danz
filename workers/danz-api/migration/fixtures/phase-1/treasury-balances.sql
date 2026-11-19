-- Rapprochement des mouvements du jeu fictif, entièrement en centimes.
WITH movements (account, cents) AS (
  SELECT 'bank', bank_cents FROM treasury_opening
  UNION ALL
  SELECT 'cash', cash_cents FROM treasury_opening
  UNION ALL
  SELECT
    CASE payment_method
      WHEN 'cash' THEN 'cash'
      WHEN 'unassigned' THEN 'unassigned'
      ELSE 'bank'
    END,
    CASE kind WHEN 'expense' THEN -amount_cents ELSE amount_cents END
  FROM treasury_entries WHERE status = 'settled'
  UNION ALL
  SELECT from_account, -amount_cents FROM treasury_transfers
  UNION ALL
  SELECT to_account, amount_cents FROM treasury_transfers
)
SELECT
  sum(cents) FILTER (WHERE account = 'bank') AS bank_cents,
  sum(cents) FILTER (WHERE account = 'cash') AS cash_cents,
  sum(cents) FILTER (WHERE account = 'unassigned') AS unassigned_cents,
  sum(cents) AS total_cents
FROM movements;
