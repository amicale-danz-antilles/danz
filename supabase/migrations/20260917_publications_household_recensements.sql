-- Affichage des publications, tarifs d'événement et recensements par foyer.
alter table public.news add column if not exists cover_fit text not null default 'contain';
alter table public.news add column if not exists show_date boolean not null default true;
alter table public.events add column if not exists cover_fit text not null default 'contain';
alter table public.events add column if not exists all_day boolean not null default false;
alter table public.events add column if not exists pricing_enabled boolean not null default false;
alter table public.events add column if not exists member_meal_cents integer not null default 0;
alter table public.events add column if not exists nonmember_meal_cents integer not null default 0;
alter table public.events add column if not exists child_prices jsonb not null default '{}'::jsonb;
alter table public.events add column if not exists pricing_notes text;
alter table public.polls add column if not exists household_mode boolean not null default true;
update public.polls set household_mode=true where poll_type='questionnaire';

do $$ begin
  if not exists(select 1 from pg_constraint where conname='news_cover_fit_check') then alter table public.news add constraint news_cover_fit_check check(cover_fit in ('contain','cover')); end if;
  if not exists(select 1 from pg_constraint where conname='events_cover_fit_check') then alter table public.events add constraint events_cover_fit_check check(cover_fit in ('contain','cover')); end if;
  if not exists(select 1 from pg_constraint where conname='events_member_meal_cents_check') then alter table public.events add constraint events_member_meal_cents_check check(member_meal_cents>=0); end if;
  if not exists(select 1 from pg_constraint where conname='events_nonmember_meal_cents_check') then alter table public.events add constraint events_nonmember_meal_cents_check check(nonmember_meal_cents>=0); end if;
end $$;

create table if not exists public.poll_household_attendance (
  poll_id uuid not null references public.polls(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  household_member_id uuid not null references public.household_members(id) on delete cascade,
  attending boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(poll_id,household_member_id)
);
create index if not exists poll_household_attendance_household_idx on public.poll_household_attendance(household_id,poll_id);
alter table public.poll_household_attendance enable row level security;
drop policy if exists "admins manage household attendance" on public.poll_household_attendance;
create policy "admins manage household attendance" on public.poll_household_attendance for all to authenticated using(private.is_admin()) with check(private.is_admin());
drop policy if exists "household members read household attendance" on public.poll_household_attendance;
create policy "household members read household attendance" on public.poll_household_attendance for select to authenticated using(private.is_admin() or household_id=private.user_household_id());

create or replace function public.submit_poll_household_questionnaire(p_poll_id uuid,p_member_ids uuid[],p_answers jsonb) returns void language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); h uuid:=private.user_household_id(); gate uuid; expected boolean; payload_gate boolean; begin
  if u is null or not private.is_active_member() or h is null then raise exception 'Accès non autorisé.'; end if;
  if not exists(select 1 from public.polls where id=p_poll_id and poll_type='questionnaire' and household_mode=true and published=true and active=true and (closes_at is null or closes_at>now())) then raise exception 'Ce recensement foyer n’est pas disponible.'; end if;
  if exists(select 1 from unnest(coalesce(p_member_ids,array[]::uuid[])) x where not exists(select 1 from public.household_members hm where hm.id=x and hm.household_id=h)) then raise exception 'Membre du foyer invalide.'; end if;
  select id into gate from public.poll_questions where poll_id=p_poll_id and attendance_gate=true limit 1;
  expected:=cardinality(coalesce(p_member_ids,array[]::uuid[]))>0;
  select (value->>'answer_boolean')::boolean into payload_gate from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb)) where value->>'question_id'=gate::text limit 1;
  if gate is null or payload_gate is distinct from expected then raise exception 'La présence du foyer est incohérente.'; end if;
  delete from public.poll_household_attendance where poll_id=p_poll_id and household_id=h;
  insert into public.poll_household_attendance(poll_id,household_id,household_member_id,attending,updated_by,updated_at) select p_poll_id,h,hm.id,(hm.id=any(coalesce(p_member_ids,array[]::uuid[]))),u,now() from public.household_members hm where hm.household_id=h;
  perform public.submit_poll_questionnaire(p_poll_id,p_answers);
end $$;
revoke all on function public.submit_poll_household_questionnaire(uuid,uuid[],jsonb) from public,anon;
grant execute on function public.submit_poll_household_questionnaire(uuid,uuid[],jsonb) to authenticated;

create or replace function private.can_view_audience(p_audience text) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active=true and (p.role='admin' or p_audience='everyone' or (p_audience='military' and (p.applicant_type='military' or p.access_type='personnel_danz')) or (p_audience='amicaliste' and p.is_amicaliste=true and p.membership_valid_until is not null and p.membership_valid_until>=current_date)));
$$;

drop policy if exists "admins view all content storage" on storage.objects;
create policy "admins view all content storage" on storage.objects for select to authenticated using(bucket_id='content' and private.is_admin());
