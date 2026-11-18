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
