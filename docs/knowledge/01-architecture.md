# Architecture technique

## Vue d'ensemble

```text
Navigateur / PWA
      |
      v
React 19 + React Router
      |
      v
Supabase JS
      |
      +--> Auth Supabase
      +--> PostgreSQL / RLS
      +--> Storage
```

Le front-end est construit avec Vite puis publié comme site statique sur GitHub Pages.

## Stack principale

D'après `package.json` :

- React : 19.x
- React DOM : 19.x
- React Router DOM : 7.x
- Vite : 7.x
- Supabase JS : 2.57.x
- `qrcode` : génération de QR codes
- `fflate` : compression / archives côté JavaScript
- `sharp` : génération / traitement d'images pendant le build

## Routage

Le point d'entrée `src/main.jsx` utilise `HashRouter`, adapté à l'hébergement statique GitHub Pages.

Le composant `src/App.jsx` centralise les routes.

Les pages d'administration sont chargées avec `lazy()` et `Suspense`.

## Authentification et autorisation

Chaîne principale :

```text
AuthProvider
   |
   +--> session Supabase
   +--> profil utilisateur
   +--> profil actif ?
   +--> rôle admin ?
   +--> rôle trésorier ?
```

- `ProtectedRoute` refuse l'accès sans utilisateur actif.
- `AdminOnly` refuse les routes d'administration aux non-administrateurs.
- `OnlineOnly` bloque les opérations sensibles en mode hors ligne.

## PWA et hors ligne

`src/main.jsx` enregistre le service worker :

`/danz/sw.js`

Le manifest est `manifest.webmanifest` avec :

- `start_url: /danz/#/`
- `scope: /danz/`
- mode `standalone`.

L'application gère une notification de mise à jour via l'événement `danz-update-ready`.

Des modules dédiés gèrent le cache et certaines mutations hors ligne :

- `src/lib/offlineCache.js`
- `src/lib/offlineMutations.js`

## Organisation du code

- `src/pages/` : pages fonctionnelles.
- `src/components/` : composants d'interface et protections de routes.
- `src/context/` : contexte d'authentification.
- `src/hooks/` : hooks React.
- `src/lib/` : accès Supabase, logique métier, trésorerie, offline, exports.
- `supabase/` : schéma initial et migrations SQL.
- `.github/workflows/` : CI/CD.
- `public/` : ressources statiques et PWA.
- `cloudflare/` : contient actuellement un worker de test de connectivité.

## Cloudflare

Le dépôt contient `cloudflare/connectivity-test-worker.js`.

Aucun élément observé dans le dépôt ne permet de conclure que Cloudflare est nécessaire au chemin de production principal. Le déploiement documenté est GitHub Pages + Supabase. Toute utilisation Cloudflare supplémentaire doit être confirmée séparément.
