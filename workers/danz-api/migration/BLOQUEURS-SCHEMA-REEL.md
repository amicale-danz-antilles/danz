# DANZ Antilles — portée réelle de la conversion du schéma

**Contrôle réalisé en lecture seule le 19 novembre 2026**, sur le projet Supabase source `axewfeanyfxkzercafen`, avec seulement des métadonnées de schéma, **aucune ligne d'adhérent ou de trésorerie**.

| Objet PostgreSQL source | Inventaire actuel | Dans le prototype D1 local |
|---|---:|---|
| Tables publiques | 36 | 36 tables `mig_*` générées en mémoire |
| Colonnes publiques | 406 | 406 colonnes de structure représentative |
| Relations FK | 89 | Relations internes publiques modélisées ; références `auth` à traiter séparément |
| Contraintes UNIQUE SQL | 10 | 10 modélisées, y compris deux composées |
| Contraintes CHECK | 73 | **Non transposées intégralement** |
| Tables protégées par RLS | 36 | **Non migrées** : la sécurité doit être gérée par le Worker |
| Politiques RLS | 77 | **Non migrées** |
| Fonctions SQL publiques | 35 | **Non migrées** |
| Déclencheurs applicatifs non internes | 31 | **Non migrés** |
| Index des tables publiques | 110 | **Non migrés intégralement** |
| Vues publiques | 0 | Aucun équivalent requis à cette date |
| Fonctions Edge Supabase | 9 | Aucun équivalent complet livré |
| RPC utilisées dans le frontend | Au moins 25 noms détectés | Aucun équivalent métier complet livré |

## Portée réelle du générateur

Fichiers :
- `source-contract.json` : liste des 36 tables et clés primaires ;
- `source-schema-metadata.json` : colonnes, types, nullabilité, clés uniques et relations, sans lignes de données ;
- `generate-d1-blueprint.mjs` : création d'un fichier SQL **de développement local exclusivement**, avec noms de tables `mig_*` (jamais les tables `stg_*` du Worker existant).

La sortie n'implémente **pas** :
- les valeurs par défaut PostgreSQL, colonnes calculées, séquences et générateurs d'identifiant ;
- toutes les subtilités `jsonb`, `timestamptz`, `float8` ;
- les 73 définitions `CHECK`, les index spécialisés ou expressions ;
- les politiques RLS, fonctions `SECURITY DEFINER`, validations côté serveur et triggers ;
- le système Supabase Auth, ses utilisateurs, fournisseurs de connexion et mots de passe ;
- le stockage binaire Supabase Storage et R2 ;
- l'atomicité et les règles métiers des paiements/charges/annulations.

La présence de toutes les colonnes et de relations dans SQLite ne doit pas être confondue avec l'équivalence de fonctionnement. Si une de ces caractéristiques manque, **interdire toute insertion de données réelles**.

## Condition de passage

1. Sauvegarde PostgreSQL source, fichier R2/Storage, rôles/configurations et restauration sur machine isolée.
2. Construire un schéma D1 réellement équivalent, ou documenter les transformations et les valider par tests.
3. Reproduire et tester les 77 politiques RLS côté serveur avec refus par défaut.
4. Reproduire et tester les 35 fonctions SQL, neuf fonctions Edge et 31 triggers suivant les dépendances réellement utilisées (les fonctionnalités non utilisées ne pouvant être retirées qu'après décision explicite).
5. Comparaison exhaustive des données, clés, champs, octets des objets et soldes.
6. Authentification réelle, reprise des comptes et autorisations trésorier vérifiées sans mot de passe en clair.
7. Retour arrière avec conservation des écritures apparues après bascule.
8. Accord explicite du trésorier après rapport de validation.

**État actuel : GO uniquement pour le développement local et les tests synthétiques, NO-GO pour la migration des données et la bascule finale.**
