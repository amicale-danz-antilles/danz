# Hébergement Cloudflare Pages en parallèle — frontend uniquement

Le site reste sous /danz/ et utilise le même Supabase, sans copie des données ni migration D1. Ne pas connecter le pilote D1 au site réel.

- Compte Cloudflare : Amicale DANZ, pas un autre compte.
- Workers & Pages : créer un projet Pages via Git, dépôt amicale-danz-antilles/danz.
- Branche de production pour cet essai : cloudflare/frontend-parallele.
- Root directory : racine du dépôt.
- Build command : npm run build:cloudflare.
- Build output directory : cloudflare-dist.
- Node : 22 (NODE_VERSION=22).
- Variables de build : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (clé publique anon/publishable exclusivement, jamais service_role ni clé secrète).
- Ne publier aucune donnée privée ou sauvegarde dans Git ou dans les ressources statiques.
- Après attribution du domaine Pages, ajouter l'URL de redirection exacte /danz/ à Supabase Auth si nécessaire, en conservant les anciennes URL. Ne pas changer SITE_URL avant tests.
- Vérifier la page, les ressources /danz/, la connexion, les droits membre/trésorier, les montants et l'absence de divergence entre les deux adresses. Aucun paiement fictif en production.
- L'accès professionnel requiert l'autorisation du service informatique et la disponibilité des domaines Pages et Supabase. Ne pas contourner les restrictions réseau. Éviter stockage local privé et installation PWA sur poste partagé ou non autorisé.
- Retour arrière : conserver GitHub Pages et retirer le nouvel hébergement si nécessaire. Les données restent uniques dans Supabase.
- Après validation, intégrer les fichiers de packaging à main puis choisir main dans Cloudflare pour éviter une branche figée.
