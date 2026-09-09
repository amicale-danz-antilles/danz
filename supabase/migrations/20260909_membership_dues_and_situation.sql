-- Suivi annuel des cotisations et distinction de situation.
-- Cette migration est idempotente autant que possible et conserve les valeurs historiques.

alter table public.profiles
  add column if not exists military_reference text;

update public.profiles
set military_reference = case
  when applicant_type = 'military' then 'danz'
  when applicant_type = 'spouse' then 'danz'
  else military_reference
end
where military_reference is null;

alter table public.profiles
  drop constraint if exists profiles_military_reference_check;

alter table public.profiles
  add constraint profiles_military_reference_check
  check (military_reference is null or military_reference in ('danz','other'));

update public.membership_requests
set military_reference = case
  when applicant_type = 'military' then 'danz'
  when applicant_type = 'spouse' then 'danz'
  else military_reference
end
where military_reference is null;

alter table public.membership_requests
  drop constraint if exists membership_requests_military_reference_check;

alter table public.membership_requests
  add constraint membership_requests_military_reference_check
  check (military_reference is null or military_reference in ('danz','other'));

create table if not exists public.membership_dues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year integer not null check (year between 2020 and 2100),
  paid boolean not null default false,
  paid_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (user_id, year)
);

create index if not exists membership_dues_updated_by_idx on public.membership_dues(updated_by);
create index if not exists membership_dues_year_paid_idx on public.membership_dues(year, paid);

alter table public.membership_dues enable row level security;

drop policy if exists "admins read membership dues" on public.membership_dues;
create policy "admins read membership dues"
on public.membership_dues for select
to authenticated
using (private.is_admin());

drop policy if exists "admins insert membership dues" on public.membership_dues;
create policy "admins insert membership dues"
on public.membership_dues for insert
to authenticated
with check (private.is_admin() and updated_by = (select auth.uid()));

drop policy if exists "admins update membership dues" on public.membership_dues;
create policy "admins update membership dues"
on public.membership_dues for update
to authenticated
using (private.is_admin())
with check (private.is_admin() and updated_by = (select auth.uid()));

drop policy if exists "admins delete membership dues" on public.membership_dues;
create policy "admins delete membership dues"
on public.membership_dues for delete
to authenticated
using (private.is_admin());

-- Le trigger d'inscription conserve la compatibilité avec applicant_type=military/spouse,
-- tout en mémorisant la distinction DANZ / autre militaire dans military_reference.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_first_name text;
  v_last_name text;
  v_applicant_type text;
  v_military_reference text;
  v_membership_request boolean;
begin
  v_full_name := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));
  v_first_name := nullif(trim(new.raw_user_meta_data->>'first_name'), '');
  v_last_name := nullif(trim(new.raw_user_meta_data->>'last_name'), '');
  v_applicant_type := case when new.raw_user_meta_data->>'applicant_type' = 'spouse' then 'spouse' else 'military' end;
  v_military_reference := case when new.raw_user_meta_data->>'military_reference' = 'other' then 'other' else 'danz' end;
  v_membership_request := coalesce((new.raw_user_meta_data->>'membership_request')::boolean, false);

  insert into public.profiles (
    id, full_name, email, role, active, applicant_type, military_reference
  ) values (
    new.id, v_full_name, new.email, 'member', false, v_applicant_type, v_military_reference
  )
  on conflict (id) do update
  set full_name = excluded.full_name,
      email = excluded.email,
      applicant_type = excluded.applicant_type,
      military_reference = excluded.military_reference;

  if v_membership_request then
    insert into public.membership_requests (
      auth_user_id,
      full_name,
      first_name,
      last_name,
      applicant_type,
      military_reference,
      is_amicaliste,
      requested_access,
      email,
      status
    ) values (
      new.id,
      v_full_name,
      v_first_name,
      v_last_name,
      v_applicant_type,
      v_military_reference,
      false,
      'member',
      lower(new.email),
      'pending'
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;
