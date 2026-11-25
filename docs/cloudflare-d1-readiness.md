# Migration complète vers Cloudflare D1 — état de préparation

Revue du 25 novembre 2026. **D1 n'est pas une base active du site. Supabase demeure l'unique source. Aucune migration de données réelles n'est autorisée par le déploiement Pages parallèle.**

## Travail réutilisable

Les branches suivantes ont été examinées sans déploiement ni exécution de leur procédure de migration :

| Branche et commit inspecté | Éléments disponibles |
| --- | --- |
| `cloudflare/danz-api-preparation` — `34c268b` | Worker `danz-api`, diagnostics, schémas financiers/identité de staging, tests et contrôles de sauvegarde |
| `cloudflare/danz-migration-phase-1-verification` — `a6c4b1f` | Restauration PostgreSQL synthétique, import SQLite local, comparaisons et décision GO/NO-GO |
| `codex/danz-pilot-synthetic` — `70ce204` | Pilote réseau, schéma de développement `mig_*`, inventaires et rapport des bloqueurs au 19 novembre |

Le rapport historique du pilote décrit 36 tables publiques, 406 colonnes, 89 relations, 73 CHECK, 77 politiques RLS, 35 fonctions SQL, 31 triggers, 110 index, neuf fonctions Edge et au moins 25 RPC appelées par le frontend. Il décrit des essais synthétiques réussis et une base `danz-staging` indépendante. **Ces nombres sont un inventaire daté, pas un nouvel audit de la source du 25 novembre.** Le travail de trésorerie récemment intégré à `main` doit être réconcilié avant toute reprise du mapping.

Les liens vers les rapports historiques restent sur leurs branches : [rapport pilote](https://github.com/amicale-danz-antilles/danz/blob/70ce20411f6e57871d841e5edbf5618688485fb6/workers/danz-api/migration/RAPPORT-PILOTE.md), [bloqueurs du schéma](https://github.com/amicale-danz-antilles/danz/blob/70ce20411f6e57871d841e5edbf5618688485fb6/workers/danz-api/migration/BLOQUEURS-SCHEMA-REEL.md), [décision de phase 1](https://github.com/amicale-danz-antilles/danz/blob/a6c4b1f15d414a660cd444a95f11b546670c5849/workers/danz-api/migration/GO-NO-GO-PHASE-1.md).

## Équivalence à construire

D1 utilise SQLite ; un dump PostgreSQL et les fonctions Supabase ne peuvent pas être importés comme une application équivalente. Les types, valeurs par défaut, identifiants, montants en centimes, contraintes, relations, procédures atomiques et index doivent être explicitement convertis et éprouvés. D1 impose les clés étrangères ; différer leur contrôle ne désactive pas les cascades. [Import/export D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [sémantique SQL](https://developers.cloudflare.com/d1/sql-api/sql-statements/)

La copie de tables ne fournit ni Supabase Auth, ni RLS, ni RPC, ni Storage, ni fonctions Edge. Il faut reconstruire côté serveur une autorisation à refus par défaut pour chaque opération, puis démontrer les droits de visiteur, membre, administrateur, trésorier et compte suspendu. Prévoir gestion des mots de passe sans exposition, récupération, expiration/révocation des sessions, journaux, protection des fichiers et des URLs signées. La simple présence de toutes les colonnes ne prouve aucune de ces garanties.

Une architecture future doit préciser le stockage des documents et médias, le service des notifications, les imports idempotents, la prévention des doubles encaissements et la cohérence des opérations concurrentes. Les diagnostics publics du pilote doivent être supprimés ou protégés avant qu'une API traite des données réelles.

## Portes obligatoires avant copie réelle ou bascule

1. **Autorisation et périmètre.** Valider avec les responsables concernés les services, postes, transferts, lieux de conservation et responsabilités ; vérifier que la solution complète respecte le budget sans abonnement supplémentaire.
2. **Inventaire actualisé.** Capturer un contrat complet de la source actuelle : tables, colonnes, clés simples/composées, contraintes, RLS, rôles, RPC, triggers, fonctions Edge, identités, stockage et fonctionnalités effectivement utilisées. Chaque différence avec le pilote doit recevoir une décision documentée.
3. **Sauvegarde indépendante restaurable.** Sur un équipement et des supports privés autorisés, sauvegarder un point cohérent PostgreSQL, les identités et droits nécessaires, les configurations et tous les octets des fichiers Supabase Storage/R2. Chiffrer les copies, séparer les clés et conserver une copie hors des services source/cible. Ne pas placer cette sauvegarde dans Git, dans `cloudflare-dist`, dans le chat ou dans un dossier synchronisé public. L'export administratif partiel ne suffit pas.
4. **Restauration isolée démontrée.** Restaurer depuis l'archive chiffrée dans une pile PostgreSQL/Supabase compatible et isolée ; comparer à une référence source indépendante. Vérifier chaque table/clé/champ, identités et droits, objets par taille/SHA-256, contraintes et soldes. Une commande de dump réussie, un manifeste construit après une copie incomplète ou un test synthétique ne constitue pas cette preuve.
5. **Répétition synthétique puis parité autorisée.** Compléter d'abord les tests synthétiques, y compris refus d'accès et erreurs. Après validation des portes précédentes, seulement dans un environnement de migration autorisé, comparer exhaustivement source et cible avec contrôles des lignes, relations, doubles clés et objets. Vérifier les soldes au centime, paiements annulés/en attente, transferts, dettes, allocations, cotisations et imports répétés. Toute divergence inexpliquée bloque l'étape suivante.
6. **Recette fonctionnelle et capacité gratuite.** Tester authentification, rôles, foyers, événements, documents, trésorerie, mobile/PWA/hors ligne et notifications. Mesurer les scans, écritures, taille et CPU sur des charges synthétiques représentatives ; garder une marge sous les plafonds gratuits et définir le comportement lorsque le quota est atteint.
7. **Retour arrière répété.** Définir le point de coupure et une seule autorité d'écriture à chaque instant. Répéter la reprise vers Supabase des écritures et objets apparus après une future bascule avec idempotence et rapprochement complet. Ne jamais simplement reconnecter une ancienne source devenue périmée. Définir responsable, fenêtre, déclencheurs et preuves.
8. **Décision distincte.** Présenter un rapport GO/NO-GO complet, avec preuves de restauration, parité, recette, quotas et retour arrière, puis recueillir la validation explicite du trésorier et les autorisations informatiques applicables avant toute bascule réelle.

## Gratuité et limites à vérifier

Au 25 novembre 2026, Workers Free inclut D1 avec dix bases, 500 Mo maximum par base, 5 Go au total, cinq millions de lignes lues et 100 000 lignes écrites par jour. Les index et scans comptent dans ces mesures. Un dépassement sur Free peut bloquer les requêtes ; aucune mise à niveau payante ne doit être activée. Les ressources Workers, le stockage d'objets et les autres services ont leurs propres contraintes. [Tarifs D1](https://developers.cloudflare.com/d1/platform/pricing/), [limites D1](https://developers.cloudflare.com/d1/platform/limits/)

Time Travel conserve jusqu'à sept jours de restauration sur le plan gratuit. Cette récupération de D1 ne remplace ni une sauvegarde source indépendante ni un exercice de restauration des comptes et fichiers. [Time Travel D1](https://developers.cloudflare.com/d1/reference/time-travel/)

**Décision actuelle : étude et tests synthétiques possibles ; copie de données réelles et bascule D1 bloquées jusqu'à validation de toutes les portes.** Aucun résultat du déploiement Pages ne doit être interprété comme une validation de migration D1.
