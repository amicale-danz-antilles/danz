# DANZ — rapport GO/NO-GO du pilote

Date : 19 novembre 2026 (Martinique). Travail exécuté sur l'ordinateur personnel.
Base de travail : `cloudflare/danz-api-preparation`, commit
`34c268b306a451d10b31d06dc7726ad02c0ad099`, PR #52 brouillon, issue #53.
Branche isolée de livraison : `codex/danz-pilot-synthetic`.

**Décision : GO pour les diagnostics et simulations synthétiques ; NO-GO pour toute
copie de données réelles ou bascule de production. Aucun accord final n'est présumé.**

## Preuves obtenues

- Contrat versionné : 36 tables et cinq clés primaires composées, neuf fonctions Edge.
  Ce contrat contient les noms et clés, pas les colonnes, types, contraintes ou RLS complets.
- Recontrôle Supabase en lecture seule des seuls noms/clés de tables et noms/statuts
  des fonctions : correspondance exacte au contrat, 36 tables et neuf fonctions actives.
  Preuve sans données métier dans `schema-metadata-check.json` ; aucune identité,
  valeur comptable, ligne métier ou donnée binaire interrogée.
- Audit du code : 25 RPC PostgreSQL distinctes utilisées par le frontend, à couvrir
  en plus des neuf fonctions Edge. Inventaire détaillé dans `COUVERTURE-FONCTIONNELLE.md`.
- Import local de COPY entièrement fictifs vers SQLite, atomique, avec relecture
  indépendante : 36 tables, 70 lignes, cinq clés composées, comparaison stricte des
  champs, identités artificielles et octets de deux fichiers artificiels R2/Storage.
- Soldes de cette simulation : banque 18 500 c, caisse 3 500 c, total 22 000 c.
  Ce scénario est distinct de `/finance-check` (17 000 c, 2 000 c, 400 c non affectés).
- Contrôles négatifs : ligne/COPY absent, troncature, doublon composé, FK rompue,
  centime modifié, entier dangereux, identité/droit altéré, fichier absent ou corrompu.
- Vérificateurs de sauvegarde renforcés : COPY complets, clés composées,
  `auth.identities`, manifeste exhaustif des fichiers **locaux**, refus des liens
  symboliques et des chemins sortants ; erreurs sans contenu privé.
- Suite locale : 96 tests réussis, aucun échec. Paquet Worker préparé par
  Wrangler 4.165.0 en mode `--dry-run`, avec uniquement la liaison `DB → danz-staging`.
- Compte Cloudflare confirmé visuellement : « Amicale Danz » ; Worker de test
  `danz-api`, D1 `danz-staging`, identifiant `40438228-8e2d-4872-9c00-17cc7ccfdd4a`.
  Aucun domaine personnalisé ni route du site des adhérents dans ce Worker.

Le schéma SQLite synthétique contient des relations représentatives. Il ne vaut
pas restauration de PostgreSQL ni reproduction des 36 schémas métier complets.

## État des prérequis réels

| Prérequis | État constaté | Conséquence |
|---|---|---|
| Export complet et cohérent PostgreSQL + identités | Non exécuté dans cette session | Transfert réel bloqué |
| Copie intégrale des octets R2 ET Supabase Storage | Non exécutée | Aucune parité de fichiers réelle attestée |
| Archive chiffrée indépendante et clé de récupération séparée | Aucune preuve fournie ou créée | Aucune sauvegarde réelle déclarée |
| Restauration PostgreSQL isolée depuis cette archive | Non exécutée | Sauvegarde non validée |
| Équipement de restauration | Docker, psql, pg_dump et CLI Supabase absents du chemin local ; Docker.app absent | Installer/configurer les outils autorisés avant procédure privée |
| Support indépendant autorisé et chiffré | Non identifié/validé | Ne pas exporter dans le dépôt ou ses dossiers synchronisés |
| Accès privés lecture seule PostgreSQL/R2/Storage | Non configurés/vérifiés pour sauvegarde | Ne pas demander de secrets dans le chat |
| Parité réelle des 36 tables, valeurs, identités et droits | Non exécutée | Les contrôles synthétiques ne la prouvent pas |
| Équivalence neuf Edge Functions + 25 RPC + RLS | Non implémentée | Backend applicatif incomplet |
| Soldes réels au centime et rapprochement bancaire | Non contrôlés dans cette session | Aucune attestation comptable réelle |
| Reprise bcrypt sans frais, MFA, récupération et révocation | Non validée en conditions Workers | Aucun login réel exposé |
| Mobiles, PWA, caches et notifications | Recette complète absente | Conserver le fonctionnement actuel |
| Autorisation informatique applicable | À confirmer par l'autorité compétente | Aucun contournement proposé |
| Retour arrière conservant les écritures nouvelles | Non démontré | Bascule interdite |

La connexion GitHub locale préexistante est invalide ; le connecteur GitHub permet
la lecture et la livraison de code synthétique. Ce point ne justifie aucune
réinitialisation ou rotation de clé de production.

## Test professionnel

Page préparée : `/pilot` sur une URL Cloudflare de préproduction confirmée après
déploiement. Ouvrir ce lien sur le poste professionnel, cliquer **Lancer les tests**,
puis transmettre seulement le résultat non nominatif du panneau prévu.

Les contrôles couvrent GET, POST, accès D1, présence et vacuité des 11 tables pilotes,
calcul fictif au centime et aller-retour d'un cookie temporaire même site. Aucun
identifiant adhérent n'est demandé. Le succès ne valide ni le futur login, ni une
autorisation réseau, ni les 36 tables réelles. Aucun envoi automatique du rapport.

## Protection du site et retour arrière du pilote

- Aucun fichier frontend, configuration Pages ou branche `main` modifié.
- Aucune écriture, fonction ou configuration Supabase modifiée.
- Aucun objet R2/Storage consulté ou transféré ; aucune donnée réelle importée.
- Aucun abonnement, plan payant, secret ou compte adhérent créé.
- PR #52 conservée en brouillon ; livraison distincte sans fusion automatique.
- Le déploiement pilote doit conserver `DB → danz-staging`. Ne jamais substituer
  un identifiant de base de production. Les routes diagnostiques n'écrivent aucune table.
- Pour retirer la page pilote, revenir à la version précédente du seul Worker de
  test, ou fermer son aperçu. Pas de restauration de la source, puisque la source
  n'est pas modifiée. Conserver les versions et preuves utiles à la revue.

## Ordre de reprise avant tout transfert réel

1. Valider appareil, support chiffré indépendant et exigences informatiques.
2. Préparer en privé les accès lecture seule et outils de sauvegarde/restauration.
3. Relire l'aide de la CLI installée avant les commandes : le changelog Supabase
   du 4 novembre 2026 annonce des changements de CLI v3. Les anciens exemples
   `--remote` de `SAUVEGARDE-PRIVEE.md` ne doivent pas être exécutés sans vérification.
4. Sauvegarder une photographie cohérente de tous les schémas, identités, droits,
   fonctions/configurations nécessaires et octets de tous les buckets employés.
   Documenter la cohérence entre base et objets sans suspendre la production
   automatiquement. L'export administratif 16/36 est insuffisant.
5. Chiffrer, conserver hors Supabase/Cloudflare et restaurer depuis l'archive dans
   une pile PostgreSQL/Supabase compatible isolée ; tester également les objets.
6. Comparer intégralement données et identités, droits, tailles/SHA-256 source/cible,
   relations, soldes et fonctions ; arrêter sur tout écart inexpliqué.
7. Compléter et éprouver l'API, l'authentification, l'interface et le retour arrière.
8. Soumettre un nouveau rapport GO/NO-GO et attendre une validation explicite du
   trésorier avant toute bascule. La présente session ne vaut pas cette validation.

Sources techniques vérifiées :
[guide Supabase sauvegarde/restauration](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[changelog CLI v3](https://supabase.com/changelog/supabase-cli-v3),
[commandes Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/).
