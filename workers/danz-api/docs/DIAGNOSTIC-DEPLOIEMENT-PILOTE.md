# DANZ — diagnostic de publication du pilote (19 novembre 2026)

Ce fichier n'exécute aucune commande et ne contient aucune donnée réelle.
Il accompagne un nouveau contrôle de déploiement de la branche de test
`codex/danz-pilot-synthetic`, sans modifier `main`, GitHub Pages ou Supabase.

## Situation observée

- Le Worker de test `danz-api` fonctionne sur `/health`.
- Le déploiement actif affiche une version antérieure ; `/pilot` retourne
  actuellement `{"ok":false,"error":"not_found"}`.
- Le code source de la branche contient pourtant `/pilot`.
- Le tableau de bord affiche `workers/danz-api` comme répertoire racine,
  `npm run build` comme build et `npx wrangler deploy` comme déploiement.
- Les exécutions échouées antérieures affichent dans leur historique
  `/` comme racine et `npx wrangler preview` comme commande :
  les historiques de builds peuvent conserver les réglages d'alors.

## Contrôle après ce commit documentaire

1. Ouvrir Workers & Pages > `danz-api` > Déploiements > dernier build.
2. Vérifier **les paramètres de CE nouveau build**, pas les paramètres actuels
   ni ceux d'un ancien build.
3. Vérifier la conclusion du déploiement et, en cas d'échec, lire les
   dernières lignes de l'étape `Déploiement`, sans divulguer de secret.
4. Si succès : ouvrir `https://danz-api.amicale-danz.workers.dev/pilot`.
5. Si échec : ne pas réessayer aveuglément ; diagnostiquer le message exact.

La branche ne contient **aucune authentification réelle** et ne doit pas
être fusionnée dans `main` ni servir à transférer des données personnelles.
