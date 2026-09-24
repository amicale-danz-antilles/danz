-- Répertoire des personnes sans compte, associables ultérieurement à un profil.
-- Chaque personne conserve son foyer et ses dettes jusqu'au rapprochement explicite.
create table if not exists public.offline_people (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  email text,
  notes text,
  household_id uuid not null unique references public.households(id) on delete restrict,
  linked_user_id uuid unique references public.profiles(id) on delete set null,
  is_amicaliste boolean not null default false,
  membership_valid_until date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offline_people_email_length check (email is null or char_length(email) <= 254),
  constraint offline_people_validity check (not is_amicaliste or membership_valid_until is not null)
);
create index if not exists offline_people_name_idx on public.offline_people(display_name);
alter table public.offline_people enable row level security;
revoke all on public.offline_people from anon;
grant select, update on public.offline_people to authenticated;
drop policy if exists "administrators see offline people" on public.offline_people;
create policy "administrators see offline people" on public.offline_people
  for select to authenticated using ((select private.is_admin()));
drop policy if exists "administrators update offline people" on public.offline_people;
create policy "administrators update offline people" on public.offline_people
  for update to authenticated using ((select private.is_admin()))
  with check ((select private.is_admin()));
-- Pas de DELETE : conserver les personnes et les références financières.

alter table public.household_charges
  add column if not exists offline_person_id uuid references public.offline_people(id) on delete restrict;
create index if not exists household_charges_offline_idx on public.household_charges(offline_person_id);

alter table public.treasury_entries
  add column if not exists advanced_by_offline uuid references public.offline_people(id) on delete restrict;
alter table public.treasury_entries drop constraint if exists treasury_advance_unique_person;
alter table public.treasury_entries
  add constraint treasury_advance_unique_person
  check (num_nonnulls(advanced_by, advanced_by_offline) <= 1);

-- Création atomique : un foyer provisoire existe pour porter les dettes éventuelles.
create or replace function public.admin_create_offline_person(
  p_name text, p_email text default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := nullif(btrim(p_name), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_household uuid;
  v_person uuid;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Administrateur requis.';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 160 then
    raise exception 'Nom invalide.';
  end if;
  if v_email is not null and (char_length(v_email)>254 or v_email !~* '^[^ @]+@[^ @]+\.[^ @]+$') then
    raise exception 'Adresse e-mail invalide.';
  end if;
  insert into public.households(name,created_by)
    values('Foyer · ' || v_name, auth.uid()) returning id into v_household;
  insert into public.offline_people(display_name,email,notes,household_id,created_by)
    values(v_name,v_email,nullif(btrim(p_notes),''),v_household,auth.uid())
    returning id into v_person;
  insert into public.admin_audit_log(actor_id,action,details)
    values(auth.uid(),'offline_person_created',jsonb_build_object('offline_person_id',v_person));
  return v_person;
end;
$$;
revoke all on function public.admin_create_offline_person(text,text,text) from public, anon;
grant execute on function public.admin_create_offline_person(text,text,text) to authenticated;

-- Rapprochement explicite par un administrateur : aucun rapprochement automatique
-- sur la base d'un e-mail saisi librement. Toutes les écritures sont transférées
-- par la fonction existante de fusion des foyers.
create or replace function public.admin_link_offline_person(
  p_person_id uuid, p_user_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_person public.offline_people%rowtype;
  v_target uuid;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Administrateur requis.';
  end if;
  select * into v_person from public.offline_people
    where id=p_person_id for update;
  if not found or v_person.linked_user_id is not null then
    raise exception 'La fiche est introuvable ou déjà associée.';
  end if;
  if not exists (select 1 from public.profiles where id=p_user_id and active=true) then
    raise exception 'Choisissez un compte actif existant.';
  end if;
  if exists (select 1 from public.offline_people where linked_user_id=p_user_id) then
    raise exception 'Ce compte possède déjà une fiche sans compte rapprochée.';
  end if;
  select household_id into v_target from public.household_members
    where user_id=p_user_id order by created_at limit 1;
  if v_target is null or v_target=v_person.household_id then
    raise exception 'Le compte doit posséder un foyer différent de la fiche provisoire.';
  end if;
  -- Propager une cotisation enregistrée avant la création du compte, sans
  -- écraser une date de validité plus récente.
  if v_person.is_amicaliste and v_person.membership_valid_until is not null then
    update public.profiles
       set is_amicaliste=true,
           membership_valid_until=greatest(
             coalesce(membership_valid_until,'0001-01-01'::date),
             v_person.membership_valid_until
           ),updated_at=now()
     where id=p_user_id;
  end if;
  update public.offline_people
     set linked_user_id=p_user_id,household_id=v_target,updated_at=now()
   where id=p_person_id;
  -- Cette fonction déplace les membres, charges, paiements, abonnements
  -- et réponses des sondages avant de supprimer uniquement le foyer vide.
  perform public.admin_merge_households(v_person.household_id,v_target);
  insert into public.admin_audit_log(actor_id,action,target_user_id,details)
    values(auth.uid(),'offline_person_linked',p_user_id,
      jsonb_build_object('offline_person_id',p_person_id,'previous_household_id',v_person.household_id));
end;
$$;
revoke all on function public.admin_link_offline_person(uuid,uuid) from public, anon;
grant execute on function public.admin_link_offline_person(uuid,uuid) to authenticated;
