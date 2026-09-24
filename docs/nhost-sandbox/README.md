# Bac à sable Nhost — foyer et trésorerie fictifs

**Uniquement dans le projet de test Nhost us-east-1. Aucune donnée réelle DANZ.**

## Si Hasura affiche « Tracking items failed » sur `danz_test_validate_allocation`

Ce n'est **pas** une erreur d'exécution SQL : `danz_test_validate_allocation()` retourne le type PostgreSQL `trigger`. Hasura ne peut pas suivre cette fonction comme fonction GraphQL : **elle doit rester non suivie**. Il ne faut ni la supprimer ni changer son type. Le déclencheur `danz_test_validate_allocation_trigger` l'exécute automatiquement lors des écritures dans `danz_test_allocations`, qu'elle soit suivie ou non.

Fermer le message de Hasura ; ne pas utiliser « Track all » pour les fonctions. Il est possible de suivre **uniquement les cinq tables fictives** si les tests GraphQL en ont besoin, sans accorder de permission `public` / `anonymous` / `user` en écriture sur les tables financières.

## Procédure de vérification

1. Dans Nhost TEST → Hasura → Data → SQL, exécuter `02_finance_fictive.sql` si ce n'est pas déjà fait. La commande est rejouable ; le script supprime/recrée seulement le déclencheur fictif.
2. Exécuter `04_verifier_installation_finance.sql` : la commande doit réussir, confirmer cinq tables et le déclencheur actif. Vérifier la liste de décomptes ; un bac à sable initialement vide doit afficher zéro partout.
3. Exécuter `03_repetition_fictive.sql` dans le SQL Editor, **en une seule exécution contenant BEGIN, DO et ROLLBACK**. La commande doit se terminer sans erreur : un paiement provenant d'un autre foyer et un dépassement de charge sont refusés. Les messages NOTICE peuvent ne pas être affichés par Nhost.
4. Réexécuter `04_verifier_installation_finance.sql` : les décomptes doivent être inchangés grâce au ROLLBACK. Si une erreur apparaît, ne pas valider l'étape sur le tableau de suivi.

La fonction de déclenchement protège l'intégrité des répartitions, mais **ne constitue pas à elle seule** la sécurité complète de la trésorerie. Les droits applicatifs, les doubles confirmations, les vérifications de soldes et la gestion concurrente seront testés séparément avant toute reprise réelle.

## Accès au suivi

- [Suivi consultable depuis le poste professionnel](https://amicale-danz-antilles.github.io/danz/suivi-migration.html), sans Supabase et **sans accès aux données privées**.
- [Vue administrateur DANZ](https://amicale-danz-antilles.github.io/danz/#/administration/migration), encore soumise à l'authentification Supabase tant que la migration n'est pas terminée.

**Ne jamais** exécuter ces scripts sur Supabase de production ou sur un projet Nhost contenant des données réelles. Les validations du suivi ne sont publiées qu'après réception de résultats vérifiables.