# DANZ — API Cloudflare de diagnostic (staging seulement)

Ce module est independant du site GitHub Pages en production.

## Objectif

Valider l'acces reseau a un Worker appartenant au **compte Cloudflare dedie a l'Amicale**, sans jamais utiliser le sous-domaine ou le compte Planet Pizza. Aucun compte adherent, mot de passe, jeton, table SQL ou media n'est traite.

Le domaine public des membres reste `https://amicale-danz-antilles.github.io/danz/`.

## Deploiement (dans le bon compte Cloudflare)

1. Selectionner le **compte Amicale Danz**, et non Planet Pizza.
2. Dans **Workers & Pages**, creer une application Worker par **Import a repository**.
3. Connecter le depot `amicale-danz-antilles/danz` en lecture pour Cloudflare.
4. Selectionner la branche **`cloudflare/danz-api-preparation`**.
5. Regler le **root directory** sur **`workers/danz-api`**.
6. Nom du Worker : **`danz-api`** (doit correspondre au fichier `wrangler.toml`).
7. Conserver un build sans compilation de l'application web. Commande de deploiement : **`npx wrangler deploy`**.
8. Verifier que l'URL publique est sous le sous-domaine du compte **Amicale Danz**, pas `planetpizza.workers.dev`.
9. Aucun secret a ajouter pour le test.

Ces menus varient selon la version de Cloudflare. Ne pas relier le Worker a la branche `main` ni modifier les parametres GitHub Pages.

## Verifications

- `GET https://<votre-worker>/health` dans le navigateur : JSON avec `ok: true`.
- Depuis `https://amicale-danz-antilles.github.io/danz/`, executer si autorise :

```js
fetch("https://<votre-worker>/connectivity-check", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ test: true }),
}).then(async (r) => console.log(r.status, await r.json()))
  .catch(console.error)
```

La requete POST declenche un **preflight CORS OPTIONS** ; les deux doivent reussir. Ne jamais envoyer d'identifiants, donnees d'adherents ou informations militaires dans cette sonde.

## Ce que ce module ne fait PAS

- Il ne remplace **pas** Supabase Auth, PostgreSQL, les fonctions serveur ni R2.
- Il ne donne **aucun** acces aux donnees DANZ.
- Il ne garantit **pas** l'autorisation du service par le reseau professionnel.
- Il ne change **rien** pour les utilisateurs actuels.

Avant toute migration reelle : accord du service informatique, sauvegarde, inventaire des fonctions, modele de securite, migration des comptes et tests d'integrite de la tresorerie.

## Test D1 (base de test vide)

Le fichier `wrangler.toml` associe le Worker au binding `DB` de la base `danz-staging`.
Ce binding doit apparaitre dans **Workers & Pages > danz-api > Parametres > Liaisons** apres deploiement.
Il ne relie pas la base au site GitHub Pages des membres.

Apres validation du build GitHub, ouvrir `https://danz-api.amicale-danz.workers.dev/db-health`.
Reponse attendue : `{"ok":true,"database":"danz-staging","stage":"binding-test","readonly":true}`.

La sonde ne fait que `SELECT 1 AS reachable`. Aucune table, donnée privee, authentification ni écriture ne sont creees.
Si le test renvoie 503, verifier la liaison D1 `DB` du Worker et le journal de build; ne pas modifier Supabase.

Pour ce test, ne saisir **aucun identifiant, nom, email, ecriture comptable ou document d'adherent** dans la base D1.

## Prototype SQL financier (préparation, NON appliqué sur D1)

Fichiers :
- `migrations/0001_staging_finance_pilot.sql` : 8 tables préfixées `stg_`, intégrité des paiements et écritures, aucune donnée réelle.
- `test/staging-finance.test.mjs` : données synthétiques uniquement, intégrées à `npm run build` via `node --test`.

Ce schéma est **un pilote partiel**, pas une copie équivalente de Supabase. Il manque notamment l'authentification, les rôles, les autorisations (RLS à remplacer par une sécurité serveur), le suivi complet des événements, les notifications, les imports et les sauvegardes. Ne pas connecter l'application des adhérents à ces tables.

**Important : les fichiers de migration ne sont PAS automatiquement appliqués par la compilation Worker.** Tant que nous ne lançons pas explicitement la migration dans D1, la base `danz-staging` conserve ses 0 table.

Précondition indispensable avant d'appliquer le schéma : confirmer le compte Cloudflare Amicale Danz, la base cible `danz-staging` et l'absence de données réelles. La commande suivante est un exemple réservé à l'étape future, **ne pas la lancer maintenant** :

```bash
npx wrangler d1 migrations apply danz-staging --remote
```

Pour les essais, ne jamais importer de noms, emails, mots de passe, photos, pièces comptables ou fichiers provenant des adhérents. Les tests synthétiques s'exécutent en local dans une base éphémère.

## Controle du schema applique dans D1 (lecture seule)

Le Worker propose maintenant `GET /schema-status` : il verifie **8 tables et 4 triggers** prefixes `stg_`, et controle si leurs lignes sont vides, sans jamais transmettre les donnees. Il **ne cree aucune table**. Resultat attendu une fois le schema installe :

```json
{"ok":true,"database":"danz-staging","stage":"finance-schema-check","tablesExpected":8,"tablesPresent":8,"triggersExpected":4,"triggersPresent":4,"empty":true,"readonly":true}
```

Si les tables n'ont pas encore ete installees, `ok:false`, `tablesPresent:0`, `triggersPresent:0` est normal : **/db-health ne teste que la connexion D1**, pas le schema. Cette sonde de staging est publique et devra etre supprimee ou protegee avant toute mise en production d'une API manipulant les donnees de l'Amicale.
