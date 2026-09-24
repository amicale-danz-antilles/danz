-- DANZ/Nhost - phase 2 du bac à sable : modèle relationnel 100 % fictif.
-- Ne pas exécuter dans Supabase ni sur un projet contenant des données réelles.
-- Ce script ne crée aucune ligne et ne migre aucun compte ni aucune donnée.
-- Tables explicitement préfixées danz_test_ : ne pas les utiliser en production.

BEGIN;

CREATE TABLE IF NOT EXISTS public.danz_test_households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_user_id)
);

CREATE TABLE IF NOT EXISTS public.danz_test_household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.danz_test_households(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  member_kind text NOT NULL CHECK (member_kind IN ('adult', 'child')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id)
);

CREATE TABLE IF NOT EXISTS public.danz_test_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.danz_test_households(id) ON DELETE CASCADE,
  member_id uuid NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, member_id)
    REFERENCES public.danz_test_household_members(household_id, id)
);

CREATE TABLE IF NOT EXISTS public.danz_test_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.danz_test_households(id) ON DELETE CASCADE,
  reference text NOT NULL UNIQUE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'declared', 'confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id)
);

CREATE TABLE IF NOT EXISTS public.danz_test_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.danz_test_households(id) ON DELETE CASCADE,
  charge_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  UNIQUE (payment_id, charge_id),
  FOREIGN KEY (household_id, charge_id)
    REFERENCES public.danz_test_charges(household_id, id),
  FOREIGN KEY (household_id, payment_id)
    REFERENCES public.danz_test_payments(household_id, id)
);

CREATE INDEX IF NOT EXISTS danz_test_members_household_idx ON public.danz_test_household_members(household_id);
CREATE INDEX IF NOT EXISTS danz_test_charges_household_idx ON public.danz_test_charges(household_id);
CREATE INDEX IF NOT EXISTS danz_test_payments_household_idx ON public.danz_test_payments(household_id);
CREATE INDEX IF NOT EXISTS danz_test_allocations_household_idx ON public.danz_test_allocations(household_id);

COMMENT ON TABLE public.danz_test_households IS 'Jeu de test uniquement, aucune information membre réelle.';
COMMENT ON TABLE public.danz_test_payments IS 'Test de contraintes uniquement ; pas de vrais paiements.';

COMMIT;

-- APRÈS exécution : "Track" les 5 tables dans Hasura, mais N'ACCORDER
-- AUCUNE permission à public, me ou user avant un audit explicite.
-- Les essais de paiements doivent utiliser des charges et références fictives.
-- Ne pas présumer que ces seules contraintes remplacent les contrôles
-- transactionnels de l'actuelle trésorerie Supabase (allocations/solde/statuts).
--
-- Nettoyage une fois la recette terminée (vérifier d'abord les relations) :
-- DROP TABLE public.danz_test_allocations;
-- DROP TABLE public.danz_test_payments;
-- DROP TABLE public.danz_test_charges;
-- DROP TABLE public.danz_test_household_members;
-- DROP TABLE public.danz_test_households;
