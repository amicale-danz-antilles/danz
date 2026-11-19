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

Un cookie de connexion cross-site demande des paramètres CORS/cookie spécifiques et peut être bloqué, partitionné ou restreint par les navigateurs. La sonde `GET /session-probe?step=set|check|clear` ne manipule que le cookie temporaire `danz_probe=1`, de validité 60 secondes, marqué `HttpOnly; Secure; SameSite=None`. Elle ne crée aucune session ni mot de passe.

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
