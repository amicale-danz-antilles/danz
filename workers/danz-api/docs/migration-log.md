# Journal de préparation — migration DANZ vers Cloudflare

Environnement : branche `cloudflare/danz-api-preparation`, Worker `danz-api`, D1 `danz-staging`.
Aucune bascule du site public, aucune importation de données personnelles.

## Étapes validées

- Connexion navigateur professionnel -> Worker, GET /health : confirmée par l'utilisateur.
- Appel CORS/POST depuis GitHub Pages -> Worker : HTTP 200, méthode POST ; confirmé par l'utilisateur.
- Liaison Worker -> D1, GET /db-health : `ok:true`, `readonly:true` ; confirmé par l'utilisateur.
- Schéma financier pilote D1 : 8 tables, 4 triggers, toutes tables vides selon `/schema-status`; confirmé par l'utilisateur.
- Calculs financiers synthétiques (uniquement CTE/VALUES, sans tables ni écriture), `/finance-check` :
  `bank_cents=17000`, `cash_cents=2000`, `unassigned_cents=400`, `total_cents=19400` ; `ok:true`, confirmé par l'utilisateur.

Ces validations ne sont pas une preuve de conformité comptable des données réelles ou d'autorisation réseau pour une migration de production.

## Authentification et autorisation : préparation

Les règles actuellement utilisées côté serveur Supabase/RLS et frontend ont servi de base à un modèle d'autorisation local **sans aucun utilisateur réel** :

- Compte actif et session vérifiée sur le serveur indispensables pour toute autorisation.
- Membre : lecture uniquement de son profil et de ses propres données de foyer.
- Administrateur actif : gestion des demandes d'adhésion, foyers et événements.
- Trésorier : administrateur actif avec `is_treasurer=true`, seul autorisé à gérer et consulter le grand livre et les soldes.
- Opérations inconnues ou non implémentées : refus par défaut.

Le modèle `src/authorizationPilot.mjs` et ses tests ne sont pas connectés aux routes publiques ; ils **n'authentifient personne**.

## Point technique avant de choisir la méthode de connexion

L'adresse du site (`https://amicale-danz-antilles.github.io/danz/`) et l'adresse du Worker (`https://danz-api.amicale-danz.workers.dev`) sont sur deux sites distincts.

Un cookie de connexion cross-site demande des paramètres CORS/cookie spécifiques et peut être bloqué, partitionné ou restreint par les navigateurs. La sonde `GET /session-probe?step=set|check|clear` ne manipule que le cookie temporaire `danz_probe=1`, de validité 60 secondes, marqué `HttpOnly; Secure; SameSite=None; Partitioned` et préfixé `__Host-`, avec `Path=/`. Elle ne crée aucune session ni mot de passe.

Avant de choisir une authentification réelle, confirmer les contraintes du navigateur professionnel et des appareils mobiles. Ne pas conseiller de désactiver les protections du réseau ou du navigateur.

## Prérequis avant données réelles

1. Approbation des usages Cloudflare par l'autorité informatique compétente si exigée.
2. Stratégie d'identité indépendante de Supabase, protection des mots de passe ou mécanisme d'identité externe, sessions sûres, MFA pour les rôles sensibles, réinitialisation de compte, protection contre abus et tentatives répétées.
3. Autorisations au niveau API pour **chaque** opération D1, audit des changements, contrôle du foyer côté serveur, autorisations de trésorerie strictes, révision des données en cache local.
4. Stratégie de migration des comptes avec conservation des accès ou réinitialisation planifiée ; ne pas supposer que les mots de passe Supabase peuvent être transférés.
5. Schéma complet D1, migrations versionnées, sauvegardes/export, mécanisme de retour arrière, vérifications financières à l'eurocent près.
6. Galerie, documents, notifications, événements, administration et stockage R2 : audit et tests de bout en bout.
7. Protection ou suppression des routes temporaires `/schema-status`, `/finance-check`, `/session-probe` avant la production.
8. Aucune fusion dans `main` ni bascule automatique de GitHub Pages avant validation de tous les contrôles.

### Résultat de la première sonde de cookie (non partitionné)

L'utilisateur a exécuté le test depuis le site DANZ avec Firefox professionnel :
`{ok:true, step:"check", cookieReceived:true, personalData:false}`.
La promesse JavaScript terminée avec une valeur `undefined` est normale.
Firefox a cependant averti : le cookie tiers `danz_probe` « sera bientôt rejeté car il est étranger et ne possède pas l'attribut Partitioned ».

Cela confirme uniquement qu'un cookie de diagnostic non partitionné a été renvoyé sur cet appareil et cette configuration à cet instant, **pas que l'authentification définitive est compatible avec tous les navigateurs**.

La sonde de test a été adaptée à `__Host-danz_probe` avec `Secure; HttpOnly; SameSite=None; Partitioned; Path=/; Max-Age=60`.
Le résultat de cette nouvelle sonde reste à valider sur Firefox professionnel, puis sur les navigateurs mobiles.

Aucun cookie de connexion réel n'est émis ; les sessions, le stockage des identités, les protections CSRF, la déconnexion et le mécanisme de récupération des comptes ne sont pas développés.

### Deuxième test des cookies partitionnés (confirmé)

Firefox professionnel a reçu et retransmis le cookie `__Host-danz_probe` partitionné :
`{ok:true,step:"check",cookieReceived:true,personalData:false}`.
Aucun avertissement n'a été transmis dans la sortie de console partagée.

Ce test ne garantit ni les navigateurs mobiles ni la persistance des sessions après un changement de navigateur ; il ne confirme pas la conformité de l'infrastructure aux politiques informatiques militaires.

### Préparation des identités et sessions (non déployée comme auth)

- `migrations/0002_staging_identity_pilot.sql` : trois tables `stg_auth_accounts`, `stg_auth_sessions`, `stg_auth_audit` et un déclencheur de révocation logique via `security_version`. Les tableaux sont vides tant que l'utilisateur n'a pas appliqué cette migration dans `danz-staging`.
- `migrations/0002_staging_identity_pilot_console.sql` : même SQL sans lignes de commentaires, destiné à la console Cloudflare D1.
- `src/authSessionPilot.mjs` : vérification de cookie opaque, empreinte SHA-256 du jeton, contrôle D1 des rôles/états, dates d'expiration, révocation, version de sécurité, et protection CSRF facultative pour les futures mutations.
- `test/auth-session-pilot.test.mjs` : tests entièrement fictifs, sans compte ni cookie réel.
- `GET /auth-schema-status` : diagnostic **en lecture seule** des trois tables et d'un déclencheur ; ne renvoie aucun contenu.

**Limites :** aucun point d'entrée de connexion n'est activé, aucun mot de passe stocké ou migré, aucune session de membre n'est créée. Il manque le fournisseur d'identité, l'authentification à facteurs multiples, la prévention des tentatives abusives, la création/réinitialisation de compte et l'expédition éventuelle des messages de confirmation.

Avant une vraie migration, réviser le risque des cookies tiers partitionnés, l'hébergement des données de personnels militaires, l'exigence d'accord informatique et la continuité des mots de passe. Ne pas fusionner sur `main` tant que ces points ne sont pas validés.

### Validation de schema d'identite pilote (confirmee)

L'utilisateur a confirme `GET /auth-schema-status` :
`{ok:true,stage:"auth-schema-check",tablesExpected:3,tablesPresent:3,triggersExpected:1,triggersPresent:1,empty:true,readonly:true}`.

D1 de test contient 8 tables financieres et 3 tables d'authentification, sans donnees personnelles.

### Sessions — etape de preparation supplementaire

- `src/sessionLifecyclePilot.mjs` produit 32 octets aleatoires pour chaque jeton de session et pour le jeton CSRF, et leur empreinte SHA-256 pour le stockage D1. Il produit un cookie `__Host-danz_session` avec `Secure; HttpOnly; SameSite=None; Partitioned; Path=/`, expiration pilote 1 heure.
- `src/authSessionPilot.mjs` exige maintenant automatiquement un CSRF pour toutes les methodes HTTP autres que GET et HEAD, meme si l'appelant ne l'a pas indique.
- `revokePilotSession` exige une requete POST, une origine autorisee, un jeton CSRF valide, et revoque exclusivement la session courante en base.
- `test/session-lifecycle-pilot.test.mjs` teste un cycle complet sur SQLite en memoire avec compte fictif et jamais dans D1 distante.
- Aucune route de connexion, de creation ou de deconnexion reelle n'est exposee ; ce module n'est pas un serveur d'identite complet.

### Point bloquant a etudier avant la reprise des mots de passe actuels

Les mots de passe existants sont sous forme de hachages bcrypt dans Supabase (et jamais en clair). Cloudflare Workers Free impose 10 ms de CPU par requete ; il ne faut pas supposer que verifier bcrypt avec un package JavaScript rentre dans cette limite. Le test de faisabilite devra se faire avec des donnees **synthetiques**, mesurer le temps CPU et valider l'option sans frais.

Une piste alternative est Cloudflare Access (offre Free pour petites equipes), avec connexion par identite/OTP/passkey, mais elle pourrait imposer une nouvelle procedure de connexion et son integration avec notre domaine GitHub Pages + Workers doit etre eprouvee avant decision. Ne pas activer Access sur le Worker de test sans plan de compatibilite des acces.

Le rapprochement entre l'identite Supabase et les profils applicatifs doit etre effectue avant toute exportation, sans modifier automatiquement les comptes orphelins. Les donnees de mot de passe et de session ne doivent jamais etre publiees dans GitHub, un log ou une capture.
