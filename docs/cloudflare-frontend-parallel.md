# Hébergement Cloudflare Pages en parallèle — frontend uniquement

Procédure revue le 25 novembre 2026. Le déploiement du frontend ne copie aucune base et ne modifie aucun solde. Supabase reste l'unique base active, avec l'authentification, les RPC et les fonctions Edge existantes. Les objets déjà présents dans Supabase Storage ou R2 restent à leur emplacement. Le pilote Workers/D1 est indépendant et ne doit pas être connecté au site réel.

## Conditions de publication et de mise en service

- Utiliser le compte Cloudflare **Amicale Danz**, jamais un autre compte.
- Conserver le plan gratuit ; ne pas activer Workers Paid, un abonnement, un domaine payant ou une nouvelle prestation. Arrêter si un écran demande de changer de plan.
- Conserver GitHub Pages à `https://amicale-danz-antilles.github.io/danz/`, son workflow et son DNS pendant toute la recette.
- Respecter le périmètre de l'autorisation du service informatique, confirmée par l'utilisateur pour cette reprise. Un test technique réussi n'étend pas cette autorisation. Ne pas utiliser proxy, VPN, tunnel ou modification DNS pour contourner un refus.
- Ne publier que `cloudflare-dist/`. Aucun export, sauvegarde, `.env`, fichier d'identité, secret ou document privé ne doit y figurer.

Les limites gratuites de Pages sont actuellement de 500 builds par mois, 20 000 fichiers et 25 MiB par fichier. Le frontend statique ne requiert ni Pages Functions ni D1. Vérifier les quotas du compte et du stockage existant avant publication ; aucune garantie de capacité gratuite illimitée n'est présumée. [Limites Pages](https://developers.cloudflare.com/pages/platform/limits/)

## Publication retenue : Direct Upload

La session Cloudflare disponible permet un téléversement depuis le tableau de bord du compte Amicale Danz. Ce mode publie le build local vérifié sans nouvelle autorisation GitHub ni jeton d'API.

1. Depuis le SHA retenu, exécuter `npm ci --no-audit --no-fund`, les tests et `npm run build:cloudflare` avec les variables publiques décrites ci-dessous.
2. Créer un ZIP contenant **le contenu** de `cloudflare-dist/` à sa racine : `danz/`, `_headers`, `_redirects`, `index.html`, `404.html`. Ne pas ajouter le dossier parent `cloudflare-dist/` dans le ZIP.
3. Dans **Workers & Pages > Create application > Pages**, choisir le téléversement direct, nommer le projet puis déposer le ZIP vérifié et publier.
4. Pour une mise à jour, utiliser **Create a new deployment** du même projet et sélectionner l'environnement voulu. Un push GitHub seul ne met pas à jour ce projet.

Le téléversement par tableau de bord accepte ZIP/dossier, avec 1 000 fichiers maximum et 25 MiB par fichier. Un projet Direct Upload ne peut pas être converti en intégration Git : il faudra créer un autre projet pour ce mode. Wrangler ou une CI dédiée restent envisageables ultérieurement, avec accès minimal et sans secret dans le dépôt. [Direct Upload Pages](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## Alternative ultérieure : projet Pages avec intégration Git

Dans **Workers & Pages**, choisir **Pages** puis l'intégration Git du dépôt `amicale-danz-antilles/danz` ; ne pas importer le projet comme Worker.

| Paramètre | Valeur |
| --- | --- |
| Branche de production de l'essai | `cloudflare/frontend-parallele` |
| Répertoire racine | Racine du dépôt |
| Commande de build | `npm run build:cloudflare` |
| Dossier de publication | `cloudflare-dist` |
| Version Node | `NODE_VERSION=22` |
| Framework | Vite, ou aucune présélection avec la commande explicite ci-dessus |

Renseigner `VITE_SUPABASE_URL` avec le projet Supabase existant et `VITE_SUPABASE_ANON_KEY` avec sa clé **publique publishable/anon**. Ces variables sont incluses dans le JavaScript du navigateur : elles ne peuvent contenir ni `service_role`, ni clé `sb_secret_*`, ni jeton Cloudflare. Ne pas communiquer de secret dans le chat ou les logs. Les clés Cloudflare n'ont aucune place dans un nom `VITE_*`.

Limiter l'autorisation GitHub de Cloudflare au dépôt nécessaire. Restreindre les previews aux branches utiles et désactiver les déploiements automatiques de l'essai après son premier déploiement si la recette n'est pas terminée. Une intégration Git peut lancer une publication à chaque push ; la PR ne doit pas déclencher involontairement une mise en service. [Intégration Git Pages](https://developers.cloudflare.com/pages/configuration/git-integration/)

Noter dans le compte rendu privé le SHA exact, le nom du projet, l'identifiant du déploiement et l'URL HTTPS `https://<projet>.pages.dev/danz/`. Aucun domaine personnalisé n'est nécessaire pour cet essai.

## Chemins, cache et dépendances réseau

Le routeur utilise les fragments : `/danz/#/connexion`, `/danz/#/agenda`, etc. Le navigateur ne transmet pas le fragment au serveur. Les ressources, le manifeste, le `start_url` et le service worker restent sous `/danz/`, avec une portée service worker limitée à `/danz/`.

La racine `/` redirige temporairement vers `/danz/`. La page `404.html` à la racine est volontaire : elle empêche Pages de substituer son index racine à toute ressource absente. Ne pas ajouter une réécriture globale de toutes les URLs vers l'application, qui masquerait des erreurs de ressources. [Routage Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/), [redirections](https://developers.cloudflare.com/pages/configuration/redirects/)

Vérifier sur l'hébergement réel les en-têtes générés dans `_headers`, les types MIME et la revalidation du HTML, de `sw.js` et du manifeste. Les en-têtes Pages n'effacent pas le cache privé créé volontairement par l'application. Une session, une PWA et les caches de l'origine GitHub ne sont pas transférés à l'origine Pages : une reconnexion et éventuellement une nouvelle autorisation de notification seront nécessaires. [En-têtes Pages](https://developers.cloudflare.com/pages/configuration/headers/)

Le service informatique doit examiner l'origine Pages **et** les dépendances réellement utilisées : `axewfeanyfxkzercafen.supabase.co` (Auth, REST, fonctions, Storage), les adresses de médias signées renvoyées par `r2-media`, et les liens externes ouverts volontairement par les membres. Un frontend autorisé ne rend pas Supabase accessible si ce dernier reste bloqué. Vérifier les règles CORS des fonctions et du stockage avec l'origine Pages exacte ; ne pas élargir les origines à `*` pour résoudre un problème d'accès privé.

Pour les parcours Auth avec redirection, ajouter si nécessaire l'URL exacte `https://<projet>.pages.dev/danz/` dans les Redirect URLs Supabase, en conservant les anciennes entrées. Ne pas remplacer `SITE_URL` avant validation des confirmations/récupérations concernées. Éviter un joker couvrant toutes les previews ; ne pas utiliser un vrai lien de récupération comme test automatique.

## Recette sans écriture métier en production

Un build réussi prouve la compilation, pas la connexion des membres ni l'accès professionnel. Consigner pour chaque contrôle : date, SHA, navigateur/appareil, résultat et éventuel blocage, sans nom de membre, capture comptable nominative ou jeton.

1. Exécuter les suites de trésorerie et `npm run build:cloudflare` avec les deux variables publiques de build. Vérifier l'absence de données privées et de secret dans le dossier publié.
2. En navigation privée, ouvrir `/`, `/danz/`, le manifeste, `sw.js` et les ressources référencées. Vérifier la redirection, l'absence d'erreur JavaScript/réseau et une vraie réponse 404 pour une ressource absente.
3. Vérifier qu'un visiteur sans session arrive à la connexion et ne reçoit aucune liste de personnes, foyer, écriture comptable ou document privé.
4. Avec des comptes existants autorisés, vérifier séparément membre, administrateur et trésorier : menus, refus des pages interdites et réponses de l'API. Les menus seuls ne prouvent pas les droits serveur. Ne pas créer de compte de test dans la production.
5. Consulter sans modification les foyers, événements, documents privés et tableaux comptables sur les deux origines. Ouvrir une pièce existante par URL signée puis vérifier que sa consultation anonyme reste refusée. Ne pas copier l'URL signée dans le rapport.
6. Rapprocher les agrégats au même instant : banque, caisse, total, créances, personnes débitrices, remboursement restant et nombre d'écritures. Arrêter sur tout écart ; ne jamais modifier un solde pour le faire correspondre. Les valeurs de référence fournies pour la reprise ne remplacent pas une lecture cohérente de la source actuelle.
7. Sur ordinateur et mobile autorisés, vérifier les vues connexion, accueil, agenda, foyers, documents et trésorerie : défilement, menus, modales, tableaux, zoom, orientation et clavier. Inclure Safari/iOS et Chrome/Android si utilisés. Une émulation ne remplace pas la recette sur appareil réel.
8. Sur un appareil personnel autorisé, contrôler rechargement, mise à jour du service worker, comportement hors ligne, reconnexion et déconnexion. Vérifier la suppression des copies privées et l'absence d'affichage de la session précédente. Sur poste professionnel ou partagé, ne pas installer la PWA ni garder une session ou copie hors ligne sans autorisation explicite.

Ne pas encaisser, importer, annuler, supprimer, créer un événement, téléverser une pièce ou produire une transaction fictive pour cette recette. Exercer les écritures uniquement dans un environnement isolé avec données synthétiques ; indiquer les parcours non testés en production.

## Retour arrière du frontend parallèle

Déclencheurs : erreur d'authentification, refus d'accès incohérent, fuite de contenu privé, ressource manquante, divergence comptable, défaut bloquant sur mobile ou refus du service informatique.

1. Cesser d'utiliser et de diffuser l'adresse Pages ; revenir à l'adresse GitHub Pages conservée. Fermer les onglets Pages, se déconnecter de cette origine et supprimer sa PWA ainsi que ses données de site sur les appareils concernés si nécessaire. La suppression locale doit être ciblée à l'origine Pages, pas à toutes les données du navigateur.
2. Désactiver les nouveaux déploiements automatiques Cloudflare. En cas de version défectueuse, sélectionner dans **Deployments** un déploiement **production** précédent réussi et encore disponible puis **Rollback to this deployment**. Un déploiement preview n'est pas une cible de rollback. [Retour arrière Pages](https://developers.cloudflare.com/pages/configuration/rollbacks/)
3. Pour un premier essai sans version saine, retirer l'exposition du seul projet Pages d'essai après conservation des preuves utiles. En cas de fuite, son retrait doit être immédiat avec les accès Cloudflare autorisés ; arrêter les builds seuls ne retire pas un site déjà publié. Ne pas supprimer le dépôt, la base, les objets, GitHub Pages ou l'ancien pilote.
4. Retirer uniquement l'éventuelle Redirect URL Supabase ajoutée pour cet essai si elle n'est plus utilisée. Préserver toutes les anciennes entrées et la configuration Auth existante.
5. Contrôler à nouveau GitHub Pages et les agrégats Supabase. Aucune restauration de base n'est nécessaire pour un rollback de frontend : les écritures légitimes des membres sont toujours dans la même source Supabase et doivent rester intactes.

Conserver hors du dossier public les preuves de recette et le dossier statique validé avec son SHA : les anciennes versions Pages peuvent être supprimées suivant la rétention du service. Un retour arrière du code ne révoque pas une donnée ou un jeton déjà divulgué ; traiter séparément tout incident constaté.

## Après validation

La branche d'essai ne doit pas devenir une copie figée du site. Après recette complète et décisions requises, intégrer les changements de packaging à `main`. Pour Direct Upload, reconstruire chaque nouvelle version depuis un SHA validé de `main` et publier le nouveau dossier vérifié. Si l'intégration Git est choisie, créer le projet adapté puis le configurer pour suivre `main`. La désactivation de GitHub Pages exige une décision ultérieure ; cette procédure ne l'autorise pas. L'étude D1 est décrite dans [cloudflare-d1-readiness.md](cloudflare-d1-readiness.md).
