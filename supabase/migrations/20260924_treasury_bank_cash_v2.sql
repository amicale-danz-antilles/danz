-- Trésorerie V2 — conservation intégrale des comptes et écritures existants.
-- Le trésorier conserve son rôle administrateur : ce droit est additionnel.
alter table public.profiles add column if not exists is_treasurer boolean not null default false;
create unique index if not exists profiles_single_treasurer_idx on public.profiles ((is_treasurer)) where is_treasurer = true;

create or replace function private.is_treasurer() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and active = true and role = 'admin' and is_treasurer = true
  );
$$;
revoke all on function private.is_treasurer() from public, anon, authenticated;

-- Attribution nominative : l'administrateur connecté active SON propre compte.
-- Verrou transactionnel et index unique empêchent deux titulaires concurrents.
create or replace function public.claim_treasurer_role() returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Seul un administrateur actif peut activer ce rôle.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(20260924);
  if exists (select 1 from public.profiles where is_treasurer and id <> auth.uid()) then
    raise exception 'Un trésorier est déjà désigné. Contactez le titulaire pour transférer le rôle.';
  end if;
  update public.profiles
     set is_treasurer = true, updated_at = now()
   where id = auth.uid() and role = 'admin' and active = true;
  if not found then raise exception 'Compte administrateur introuvable.'; end if;
  insert into public.admin_audit_log(actor_id, action, target_user_id, details)
    values (auth.uid(), 'treasurer_role_claimed', auth.uid(), '{}'::jsonb);
  return true;
end;
$$;
revoke all on function public.claim_treasurer_role() from public, anon;
grant execute on function public.claim_treasurer_role() to authenticated;

-- La position initiale est un relevé réel à saisir par le trésorier.
-- Les écritures ANTÉRIEURES au relevé restent dans l'historique mais ne sont
-- pas comptées une deuxième fois dans le solde de caisse / banque.
create table if not exists public.treasury_opening (
  id smallint primary key default 1 check (id = 1),
  bank_cents bigint not null default 0,
  cash_cents bigint not null default 0,
  as_of timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.treasury_opening enable row level security;
grant select, insert, update on public.treasury_opening to authenticated;
drop policy if exists "treasurer read opening" on public.treasury_opening;
create policy "treasurer read opening" on public.treasury_opening
  for select to authenticated using ((select private.is_treasurer()));
drop policy if exists "treasurer create opening" on public.treasury_opening;
create policy "treasurer create opening" on public.treasury_opening
  for insert to authenticated with check ((select private.is_treasurer()) and updated_by = (select auth.uid()));
drop policy if exists "treasurer update opening" on public.treasury_opening;
create policy "treasurer update opening" on public.treasury_opening
  for update to authenticated using ((select private.is_treasurer()))
  with check ((select private.is_treasurer()) and updated_by = (select auth.uid()));

-- Transfert interne : une seule opération, aucune fausse recette / dépense.
create table if not exists public.treasury_transfers (
  id uuid primary key default gen_random_uuid(),
  from_account text not null check (from_account in ('cash', 'bank')),
  to_account text not null check (to_account in ('cash', 'bank')),
  amount_cents integer not null check (amount_cents > 0),
  occurred_at timestamptz not null default now(),
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint treasury_transfer_different_accounts check (from_account <> to_account)
);
create index if not exists treasury_transfers_occurred_idx on public.treasury_transfers(occurred_at desc);
alter table public.treasury_transfers enable row level security;
grant select, insert on public.treasury_transfers to authenticated;
drop policy if exists "treasurer read transfers" on public.treasury_transfers;
create policy "treasurer read transfers" on public.treasury_transfers
  for select to authenticated using ((select private.is_treasurer()));
drop policy if exists "treasurer insert transfers" on public.treasury_transfers;
create policy "treasurer insert transfers" on public.treasury_transfers
  for insert to authenticated with check ((select private.is_treasurer()) and created_by = (select auth.uid()));

-- Date comptable et nature des dépenses (sans altérer les anciennes lignes).
alter table public.treasury_entries add column if not exists category text;
alter table public.treasury_entries add column if not exists occurred_at timestamptz;
update public.treasury_entries set occurred_at = created_at where occurred_at is null;
alter table public.treasury_entries alter column occurred_at set default now();
alter table public.treasury_entries alter column occurred_at set not null;
alter table public.treasury_entries add column if not exists reimbursement_method text
  check (reimbursement_method in ('cash','bank_transfer','card'));
create index if not exists treasury_entries_occurred_idx on public.treasury_entries(occurred_at desc);

-- Une seule personne dispose de l'interface et des nouvelles écritures.
drop policy if exists "admins manage treasury" on public.treasury_entries;
drop policy if exists "treasurer read treasury" on public.treasury_entries;
create policy "treasurer read treasury" on public.treasury_entries
  for select to authenticated using ((select private.is_treasurer()));
drop policy if exists "treasurer create treasury" on public.treasury_entries;
create policy "treasurer create treasury" on public.treasury_entries
  for insert to authenticated with check ((select private.is_treasurer()) and created_by = (select auth.uid()));
drop policy if exists "treasurer update treasury" on public.treasury_entries;
create policy "treasurer update treasury" on public.treasury_entries
  for update to authenticated using ((select private.is_treasurer()))
  with check ((select private.is_treasurer()));
-- Aucun DELETE de la trésorerie : historique comptable préservé.
