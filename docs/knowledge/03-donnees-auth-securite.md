# Données, authentification et sécurité

## Configuration Supabase

Le client Supabase est créé dans `src/lib/supabase.js`.

Variables attendues :

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Ne jamais placer de clé secrète, service role key, mot de passe ou jeton privé dans cette documentation ou dans Open WebUI.

## Session

Supabase est configuré avec :

- persistance de session ;
- rafraîchissement automatique du token ;
- détection de session dans l'URL.

## Contrôle d'accès applicatif

`AuthContext.jsx` charge le profil associé à l'utilisateur authentifié.

Règles principales observées :

- un profil doit avoir `active === true` ;
- un administrateur doit avoir `role === 'admin'` et être actif ;
- un trésorier est un administrateur actif avec `is_treasurer === true`.

Si le profil est absent ou inactif, l'utilisateur est déconnecté localement.

## Connexion et inscription

Le code actuel utilise :

- `signInWithPassword` pour la connexion ;
- `signUp` pour une demande d'adhésion / création de compte.

Les métadonnées d'inscription incluent notamment nom, prénom, type de demande et informations de situation.

## Schéma initial

Le fichier `supabase/schema.sql` définit notamment :

- `profiles`
- `news`
- `events`
- `documents`
- `gallery`

Il active Row Level Security (RLS) sur ces tables.

Une fonction `public.is_admin()` sert aux politiques administrateur.

Le bucket Storage `documents` est privé.

## Politiques RLS initiales

Le schéma initial prévoit :

- lecture du contenu par les utilisateurs authentifiés ;
- gestion du contenu par les administrateurs ;
- lecture des profils par leur propriétaire ou un administrateur ;
- gestion du bucket documents limitée par rôle.

## Migrations

Le schéma initial n'est pas le schéma complet actuel.

Le dossier `supabase/migrations/` contient des évolutions concernant notamment :

- cotisations ;
- workflows de contenu et notifications ;
- questionnaires ;
- foyers ;
- recensements ;
- trésorerie banque / caisse ;
- suivi d'événements ;
- imports / exports Excel ;
- annuaire et personnes hors ligne ;
- audit financier.

Pour toute question précise sur une table, une RPC ou une politique RLS, consulter la migration la plus récente correspondant au domaine.

## Cache hors ligne

Le profil peut être lu depuis le cache local lorsque le réseau est indisponible, à condition que le profil mis en cache soit actif.

Les données hors ligne doivent être considérées comme un mécanisme de continuité d'usage, pas comme une source de vérité pour les opérations financières ou administratives.
