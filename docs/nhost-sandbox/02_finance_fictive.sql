-- Migration DANZ / Nhost — schéma fictif uniquement (us-east-1).
-- A lancer MANUELLEMENT dans le projet Nhost de TEST après validation.
-- Ne contient ni comptes ni données réels. Ne pas placer dans nhost/migrations
-- tant que la liaison Git Nhost et le déploiement automatique n'ont pas été vérifiés.
CREATE TABLE IF NOT EXISTS public.danz_test_households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.danz_test_household_access (
  household_id uuid NOT NULL REFERENCES public.danz_test_households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (household_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.danz_test_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.danz_test_households(id) ON DELETE RESTRICT,
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.danz_test_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.danz_test_households(id) ON DELETE RESTRICT,
  reference text NOT NULL UNIQUE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  method text NOT NULL CHECK (method IN ('cash','bank_transfer')),
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','declared','confirmed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.danz_test_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.danz_test_charges(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.danz_test_payments(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  UNIQUE (charge_id,payment_id)
);
-- Contrôles impératifs en base : même foyer, jamais plus que les montants source.
-- Le verrouillage des lignes source empêche deux allocations concurrentes
-- de dépasser la dette ou le règlement.
CREATE OR REPLACE FUNCTION public.danz_test_validate_allocation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  charge_household uuid;
  payment_household uuid;
  charge_amount bigint;
  payment_amount bigint;
  applied_charge bigint;
  applied_payment bigint;
BEGIN
  SELECT household_id,amount_cents INTO charge_household,charge_amount
    FROM public.danz_test_charges WHERE id=NEW.charge_id FOR UPDATE;
  SELECT household_id,amount_cents INTO payment_household,payment_amount
    FROM public.danz_test_payments WHERE id=NEW.payment_id FOR UPDATE;
  IF charge_household IS NULL OR payment_household IS NULL OR charge_household<>payment_household THEN
    RAISE EXCEPTION 'Allocation interdite entre deux foyers' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(amount_cents),0) INTO applied_charge
    FROM public.danz_test_allocations WHERE charge_id=NEW.charge_id AND id IS DISTINCT FROM NEW.id;
  SELECT COALESCE(sum(amount_cents),0) INTO applied_payment
    FROM public.danz_test_allocations WHERE payment_id=NEW.payment_id AND id IS DISTINCT FROM NEW.id;
  IF applied_charge+NEW.amount_cents>charge_amount OR applied_payment+NEW.amount_cents>payment_amount THEN
    RAISE EXCEPTION 'Allocation supérieure au montant disponible' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS danz_test_validate_allocation_trigger ON public.danz_test_allocations;
CREATE TRIGGER danz_test_validate_allocation_trigger
BEFORE INSERT OR UPDATE ON public.danz_test_allocations
FOR EACH ROW EXECUTE FUNCTION public.danz_test_validate_allocation();
-- SECURITE : ne configurer AUCUNE permission Hasura publique / user en écriture
-- sur ces tables de finance avant d'avoir validé des règles équivalentes à celles
-- du projet Supabase. Les opérations financières devront passer par des fonctions
-- serveur vérifiant l'identité et les droits administrateur.
