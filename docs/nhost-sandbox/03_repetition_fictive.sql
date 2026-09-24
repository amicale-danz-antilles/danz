-- Recette fictive, sans persistance : succès + tests de rejet + ROLLBACK.
-- Exécuter après 02_finance_fictive.sql dans le projet Nhost de test.
BEGIN;
DO $$
DECLARE
  home_a uuid;
  home_b uuid;
  charge_a uuid;
  pay_a uuid;
  pay_b uuid;
BEGIN
  INSERT INTO public.danz_test_households(label) VALUES ('FOYER FICTIF A') RETURNING id INTO home_a;
  INSERT INTO public.danz_test_households(label) VALUES ('FOYER FICTIF B') RETURNING id INTO home_b;
  INSERT INTO public.danz_test_charges(household_id,label,amount_cents)
    VALUES(home_a,'Repas fictif',2500) RETURNING id INTO charge_a;
  INSERT INTO public.danz_test_payments(household_id,reference,amount_cents,method)
    VALUES(home_a,'FICTIF-A',2500,'cash') RETURNING id INTO pay_a;
  INSERT INTO public.danz_test_payments(household_id,reference,amount_cents,method)
    VALUES(home_b,'FICTIF-B',2500,'bank_transfer') RETURNING id INTO pay_b;
  INSERT INTO public.danz_test_allocations(charge_id,payment_id,amount_cents)
    VALUES(charge_a,pay_a,1250);
  RAISE NOTICE 'OK : allocation légitime de 12,50 € dans le même foyer';
  BEGIN
    INSERT INTO public.danz_test_allocations(charge_id,payment_id,amount_cents)
      VALUES(charge_a,pay_b,100);
    RAISE EXCEPTION 'ERREUR DE RECETTE : répartition entre foyers acceptée';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK : paiement de foyer étranger refusé';
  END;
  BEGIN
    INSERT INTO public.danz_test_allocations(charge_id,payment_id,amount_cents)
      VALUES(charge_a,pay_b,2000);
    RAISE EXCEPTION 'ERREUR DE RECETTE : dépassement accepté';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK : deuxième contrôle de foyer refusé';
  END;
  -- Pour contrôler spécifiquement le dépassement, ajouter un second paiement
  -- du foyer A, et tenter 1500 € après les 1250 € déjà répartis.
  INSERT INTO public.danz_test_payments(household_id,reference,amount_cents,method)
    VALUES(home_a,'FICTIF-A2',2500,'cash') RETURNING id INTO pay_b;
  BEGIN
    INSERT INTO public.danz_test_allocations(charge_id,payment_id,amount_cents)
      VALUES(charge_a,pay_b,1500);
    RAISE EXCEPTION 'ERREUR DE RECETTE : surallocation acceptée';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK : dépassement de charge refusé';
  END;
END $$;
ROLLBACK;
-- Le ROLLBACK annule TOUS les foyers, charges, paiements et allocations fictifs.
