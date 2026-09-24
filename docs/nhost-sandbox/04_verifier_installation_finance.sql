-- Vérification NON DESTRUCTIVE de l'installation du bac à sable financier Nhost.
-- Exécuter dans Hasura -> Data -> SQL du projet TEST uniquement.
-- IMPORTANT : NE PAS "TRACK" la fonction danz_test_validate_allocation.
-- Elle RETURNS trigger : Hasura ne peut pas l'exposer comme fonction GraphQL.
-- Le déclencheur PostgreSQL fonctionne SANS suivi dans Hasura.

DO $$
DECLARE
  missing_tables text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO missing_tables
  FROM (VALUES
    ('danz_test_households'),
    ('danz_test_household_access'),
    ('danz_test_charges'),
    ('danz_test_payments'),
    ('danz_test_allocations')
  ) AS required(name)
  WHERE to_regclass('public.' || name) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Tables fictives absentes : %. Réexécuter 02_finance_fictive.sql sur le projet de TEST.', missing_tables;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='danz_test_validate_allocation'
      AND pg_get_function_result(p.oid)='trigger'
  ) THEN
    RAISE EXCEPTION 'Fonction déclencheur manquante ou de type incorrect.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname='danz_test_allocations'
      AND t.tgname='danz_test_validate_allocation_trigger'
      AND t.tgenabled IN ('O', 'A', 'R')
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Déclencheur anti-surallocation absent ou désactivé.';
  END IF;

  RAISE NOTICE 'OK : cinq tables fictives, fonction RETURNS trigger, déclencheur actif.';
END $$;

-- Ces décomptes concernent UNIQUEMENT les tables fictives de TEST.
-- Après 03_repetition_fictive.sql (avec ROLLBACK), un bac à sable
-- initialement vide doit toujours avoir 0 ligne dans chaque table.
SELECT 'households' AS fictive_table, count(*) AS rows FROM public.danz_test_households
UNION ALL SELECT 'household_access', count(*) FROM public.danz_test_household_access
UNION ALL SELECT 'charges', count(*) FROM public.danz_test_charges
UNION ALL SELECT 'payments', count(*) FROM public.danz_test_payments
UNION ALL SELECT 'allocations', count(*) FROM public.danz_test_allocations;
