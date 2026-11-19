# Migration DANZ Antilles · décision de phase 1

**GO pour la revue humaine du mécanisme synthétique. NO-GO pour toute copie de données réelles et pour la bascule.** La phase 1 vérifie une répétition locale avec des exports PostgreSQL fictifs et un mapping SQLite abrégé. Le [suivi fonctionnel et les écarts d’inventaire](INVENTAIRE-PHASE-1.md) définissent le périmètre restant.

## Reproduire la répétition locale

Depuis `workers/danz-api/`, avec Node 22 à jour (ou ultérieur) et Docker pour la seule commande PostgreSQL.

```sh
node --test
node migration/dry-run.mjs
docker pull postgres@sha256:526f86d93c6ea08fd3f1fe5605650cacc781b2c6013169a0ad8f42c7d3d84f32
node migration/restore-synthetic-postgres.mjs
```

- **Restauration PostgreSQL fictive.** Le script charge le schéma et les blocs COPY versionnés dans un cluster neuf à l’intérieur d’un conteneur jetable, sans réseau, port ni montage. `psql` rejoue les deux fichiers en une transaction avec `ON_ERROR_STOP`. Le script relit les clés primaires dans le catalogue et compare chaque champ restauré à un référentiel synthétique distinct du COPY.
- **Transfert vers SQLite.** Le dry-run interprète le COPY de la fixture et charge le mapping explicite en mémoire, par une transaction avec contrôle des relations. Le moteur est SQLite local. La déclaration des colonnes, les clés et les relations couvrent la fixture. Les adaptateurs de types et les contraintes du véritable schéma D1 restent à concevoir.
- **Contrôle de parité.** Le vérificateur relit SQLite après l’import, contrôle le schéma et les relations, puis compare les lignes par clé, y compris les clés composées, au même référentiel indépendant. Les cas négatifs modifient chaque élément à contrôler et attendent un échec. Un centime est comparé comme entier exact. Les inventaires d’identité et les fichiers sont exercés par les tests de comparaison et de sauvegarde avec données synthétiques.
- **Vérification d’une sauvegarde.** Les scripts locaux contrôlent la structure des exports textuels et la copie binaire. Un dump cohérent dont une ligne entière a disparu ou un manifeste construit après une copie incomplète peuvent passer le contrôle interne. Pour prouver la complétude, conserver un inventaire et une photographie de référence indépendants, puis comparer la restauration à ces références.

Les deux commandes de répétition utilisent uniquement les fichiers versionnés sous [fixtures/phase-1](fixtures/phase-1). Elles renvoient un code non nul en cas d’écart. Les workflows exécutent les tests sans accès à Supabase ni à une base D1 distante.

Le rapprochement fictif attendu est de **10 500 c en banque, 600 c en caisse et 400 c non affectés**, soit 11 500 c au total. Les tests vérifient aussi que deux erreurs qui se compensent dans les soldes échouent au contrôle ligne par ligne.

## Portes avant toute migration réelle

| Porte | État | Preuve attendue et décision |
| --- | --- | --- |
| Sauvegardes chiffrées indépendantes | **Bloquant · à effectuer** | Accord du trésorier pour la procédure et le périmètre. Sur poste et supports approuvés, capturer un point cohérent pour PostgreSQL, l’identité et les objets de chaque stockage. Prévoir aussi les sources Edge, les configurations, les droits, les déclencheurs, les historiques et les éléments sensibles selon la procédure autorisée. Le trésorier atteste de la disponibilité des deux copies et de la récupération des clés. [Procédure privée](SAUVEGARDE-PRIVEE.md) |
| Restauration réelle isolée | **Bloquant · à tester** | Restaurer la sauvegarde réelle dans un environnement isolé spécifiquement autorisé. Contrôler contraintes, droits, identités et objets à partir d’une référence indépendante. Le trésorier valide les écritures historiques, justificatifs, soldes initiaux, comptes, transferts, annulations, cotisations et allocations en centimes. L’exercice PostgreSQL de cette phase ne porte que sur le jeu fictif. |
| Schéma et fonctions | **Bloquant · écarts ouverts** | Réconcilier les DDL absents, `membership_dues`, le statut de l’assistant, les fonctions Edge et les dépendances non visibles. Geler le contrat de source et définir les règles explicites de transformation et de contrôle. [Inventaire](INVENTAIRE-PHASE-1.md) |
| Bcrypt et Workers Free | **Bloquant · non validé** | Mesurer le coût CPU avec identités et empreintes exclusivement synthétiques, aux paramètres autorisés. Exercer les parcours connexion, récupération, expiration et révocation ainsi que les rôles. Valider une solution sans facturation et sans exposition des empreintes. |
| Navigation mobile, PWA et hors ligne | **Bloquant · à valider** | Tester sur les appareils autorisés réellement utilisés, notamment Safari/iOS et Chrome/Android. Vérifier navigation et application installée, cookies et reconnexion, éviction du cache privé, notifications et reprise après perte de réseau. |
| Conformité informatique | **Bloquant · accord requis** | Obtenir la validation formelle de l’autorité informatique compétente pour le stockage, le transfert et les postes autorisés, les accès, la durée de conservation et la protection des données des personnels. Le trésorier intervient sur les données de trésorerie et les justificatifs. |
| Retour arrière | **Bloquant · exercice à faire** | Répéter un retour sur la source en préservant toutes les écritures intervenues après la future bascule, y compris les opérations en attente et les fichiers. Définir l’instant de référence, la reprise idempotente, le rapprochement, le responsable et les seuils de déclenchement. Le trésorier valide la procédure et les soldes obtenus. |
| Décision de bascule | **NO-GO** | Préparer une étape distincte avec équivalence fonctionnelle et comptable, preuves de sauvegarde/restauration et de retour arrière, puis recueillir la validation explicite du trésorier avant toute intervention sur la production. |
