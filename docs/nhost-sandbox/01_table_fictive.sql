-- DANZ / Nhost : bac à sable strictement fictif.
-- À exécuter UNIQUEMENT dans le projet Nhost de TEST (us-east-1).
-- Ne contient aucune donnée réelle DANZ ; ne touche pas Supabase.
-- À supprimer une fois les essais terminés.

create table if not exists public.danz_nhost_test_notes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  note text not null check (char_length(note) between 1 and 120),
  created_at timestamptz not null default now()
);

create index if not exists danz_nhost_test_notes_owner_idx
  on public.danz_nhost_test_notes(owner_user_id, created_at desc);

comment on table public.danz_nhost_test_notes is
  'TABLE DE TEST : notes fictives pour vérifier les permissions Nhost. Ne pas utiliser pour des données réelles.';

-- Étape INDISPENSABLE dans Nhost > Database > public >
-- danz_nhost_test_notes > Edit Permissions.
--
-- Pour le rôle "user" uniquement :
-- SELECT : row check owner_user_id = X-Hasura-User-Id
--          colonnes id, owner_user_id, note, created_at
-- INSERT : row check owner_user_id = X-Hasura-User-Id
--          column preset owner_user_id = X-Hasura-User-Id
--          autoriser à fournir UNIQUEMENT la colonne note
-- DELETE : row check owner_user_id = X-Hasura-User-Id
-- UPDATE : désactivé pour ce test
-- Rôle "public" / "anonymous" : AUCUNE permission.
-- Ne pas utiliser le rôle admin ou exposer le Hasura admin secret au navigateur.
-- Nhost pourra demander d'ajouter cette table aux métadonnées Hasura (Track Table).
--
-- SQL de nettoyage après tests :
-- DROP TABLE public.danz_nhost_test_notes;
