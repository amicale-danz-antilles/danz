# Préparation migration DANZ : Supabase → Nhost (23 septembre 2026)

**Statut : audit uniquement, aucune donnée personnelle transférée, aucun changement sur `main`.** Ce document est une feuille de route ; les chiffres ci-dessous sont des mesures ponctuelles, à reprendre le jour du basculement.

## Connectivité déjà validée depuis le poste professionnel

- Nhost Auth : GET `/v1/version` → HTTP 200
- Nhost GraphQL : POST `/v1` avec `{ __typename }` → HTTP 200 et `query_root`
- Nhost Storage : GET d'un identifiant de fichier inexistant → HTTP 403 (service atteint, accès sans jeton refusé)
- **Restent à vérifier** : connexion réelle d'un compte fictif ; lecture/écriture autorisée via Hasura ; upload/lecture autorisée d'un fichier fictif ; Functions ; R2 et les autres services tiers ; fonctionnement PWA et CORS dans le navigateur professionnel. Ces tests ne nécessitent **aucune** donnée réelle de membre.

## Inventaire Supabase de départ (lecture seule)

- 29 tables `public`, toutes sous RLS ; fonctions SQL : 17 `public` et 24 `private`.
- 25 comptes `auth.users` (25 empreintes de mots de passe de type bcrypt) ; 24 profils, dont 1 compte Auth sans profil. Aucune identité ni aucune empreinte de mot de passe ne figure dans ce dépôt.
- 24 foyers ; 3 événements ; 2 éléments de galerie ; 3 pièces jointes ; 83 bons plans ; 1 sondage ; 45 réponses au questionnaire ; 1 écriture de trésorerie. Les montants, données nominatives et fichiers ne doivent pas figurer dans Git.
- 8 fonctions Edge actives à réécrire/adapter : `approve-membership-request`, `send-member-login-link`, `push-notifications`, `r2-media`, `admin-user-management`, `admin-data-export`, `admin-system-status`, `request-membership`.
- Dépendances client : `@supabase/supabase-js` dans `src/lib/supabase.js`, `AuthContext` et les pages ; les RPC et RLS Supabase sont spécifiques au fournisseur. Les remplacer ne se résume pas à changer l'URL.

## Préalable sur la localisation

Le projet Nhost de connectivité actuel est en `us-east-1` (Virginie). Avant d'y importer des données personnelles ou financières, vérifier la région européenne disponible, les engagements contractuels applicables et les contraintes de l'organisation. Une autre région nécessite de nouveaux tests de connectivité ; ne pas présumer que le résultat `us-east-1` est transposable. Dans l'offre Starter, tenir compte de la limite des projets actifs.

## Méthode de migration par étapes

1. **Projet Nhost de test en région retenue** : utiliser uniquement des utilisateurs, foyers, paiements et pièces jointes fictifs. Aucun secret dans Git, le navigateur, les captures ou le chat.
2. **Schéma** : porter les tables `public` en conservant les UUID, contraintes, historiques et intégrité référentielle ; adapter les fonctions SQL qui utilisent `auth.uid()`, `auth.jwt()`, `private.is_admin()`, `storage`, `pg_net`, `pg_cron` ou le Vault. Ne jamais restaurer les schémas internes `auth` / `storage` de Supabase dans ceux de Nhost.
3. **Autorisations** : convertir explicitement les règles RLS/PostgREST Supabase en permissions de rôle Hasura/Nhost ; tester les cas membre de foyer, adulte du même foyer, admin, compte inactif et utilisateur anonyme. Écriture comptable autorisée uniquement par le serveur ou le trésorier selon les règles existantes. Vérifier qu'un membre ne peut pas lire un autre foyer ou s'attribuer le rôle admin.
4. **Identité** : préparer l'import contrôlé de `auth.users` vers le schéma Nhost adapté, en conservant les UUID et les empreintes bcrypt si la compatibilité de version est validée sur **un compte fictif uniquement**. Revoir le compte d'authentification sans profil : ne jamais le supprimer automatiquement. Reconfigurer les e-mails de vérification et réinitialisation, permissions et flux d'approbation. Les sessions Supabase existantes ne sont pas transférables : prévoir une reconnexion unique lors du basculement.
5. **Médias** : répertorier R2, Supabase Storage, les albums et les justificatifs ; contrôler les accès effectifs depuis le réseau professionnel ; migrer/reconfigurer uniquement ce qui est nécessaire avec des URLs signées et des permissions équivalentes.
6. **Frontend** : isoler la couche d'accès aux données et adapter les appels PostgREST en GraphQL/API serveur ; remplacer les 8 fonctions Edge ; tester les fonctionnalités complètes (publications, recensements, cotisations annuelles, paiements, trésorerie, PWA/offline).
7. **Recette** : contrôles automatisés de build/sécurité et tests navigateur, puis rapprochement table par table des nombres de lignes, clés, liens, agrégats financiers, droits de lecture et historique d'audit. Ne pas exposer de base réelle sur un GitHub public.
8. **Basculement** : sauvegarde restaurable vérifiée ; petite fenêtre de gel des écritures ; export final sécurisé des seules données utiles et import en région approuvée ; réconciliation ; configuration de l'application GitHub Pages ; incrément du cache PWA ; smoke test et plan de retour arrière. Garder Supabase en lecture seule jusqu'à acceptation.

## Critères avant d'annoncer une migration transparente

- Compte fictif importé : ancien e-mail et ancien mot de passe valides sur Nhost (ou, si impossible, procédure de réinitialisation préparée).
- Les 25 comptes sont traités sans omission, y compris l'absence de profil pour un compte, et les 24 profils sont conservés avec les mêmes UUID.
- Aucune nouvelle dette ni aucun paiement perdu, en double ou modifiable par un utilisateur non autorisé.
- La connexion privée Nhost fonctionne depuis les réseaux testés (poste pro et mobile) ; un 403 du stockage anonyme **n'est pas** à lui seul une preuve d'accès authentifié.
- Tous les contrôles et sauvegardes sont validés **avant** modification de la production.

Liens de documentation à utiliser pendant l'implémentation : https://docs.nhost.io/products/auth/users ; https://docs.nhost.io/platform/cli/local-development ; https://docs.nhost.io/platform/cloud/billing.
