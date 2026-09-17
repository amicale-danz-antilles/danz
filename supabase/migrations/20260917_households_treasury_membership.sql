-- Foyers, cotisation amicaliste annuelle, dettes, paiements et trésorerie.
-- Cette migration représente le socle V2 appliqué en production le 17/09/2026.

alter table public.profiles add column if not exists membership_valid_until date;

create table if not exists public.association_settings (
  id smallint primary key default 1 check (id=1),
  association_name text not null default 'Amicale DANZ Antilles',
  bank_name text,
  account_name text,
  iban text,
  bic text,
  membership_fee_cents integer not null default 6000 check (membership_fee_cents>=0),
  child_age_categories jsonb not null default '["0–5 ans","6–12 ans","13–17 ans"]'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.association_settings(id) values(1) on conflict(id) do nothing;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid unique references public.profiles(id) on delete cascade,
  display_name text not null,
  member_type text not null default 'adult' check(member_type in ('adult','child')),
  age_category text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((member_type='adult' and user_id is not null and age_category is null) or (member_type='child' and user_id is null and age_category is not null))
);
create index if not exists household_members_household_idx on public.household_members(household_id);

create table if not exists public.household_charges (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  household_member_id uuid references public.household_members(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  category text not null check(category in ('membership','meal','drinks','activity','adjustment','other')),
  label text not null,
  amount_cents integer not null check(amount_cents>0),
  status text not null default 'open' check(status in ('open','cancelled')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz
);
create index if not exists household_charges_household_idx on public.household_charges(household_id,status);

create sequence if not exists public.household_payment_reference_seq;
create table if not exists public.household_payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  amount_cents integer not null check(amount_cents>0),
  method text not null default 'bank_transfer' check(method in ('bank_transfer','cash')),
  status text not null default 'prepared' check(status in ('prepared','declared','confirmed','cancelled')),
  reference text not null unique,
  note text,
  declared_by uuid references public.profiles(id) on delete set null,
  declared_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.household_payment_allocations (
  payment_id uuid not null references public.household_payments(id) on delete cascade,
  charge_id uuid not null references public.household_charges(id) on delete cascade,
  amount_cents integer not null check(amount_cents>0),
  primary key(payment_id,charge_id)
);

create table if not exists public.membership_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  charge_id uuid unique references public.household_charges(id) on delete set null,
  starts_on date not null,
  ends_on date not null,
  amount_cents integer not null default 6000 check(amount_cents>=0),
  status text not null default 'pending' check(status in ('pending','paid','cancelled')),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  check(ends_on>=starts_on)
);

create table if not exists public.treasury_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('income','expense','reimbursement','cash_adjustment')),
  amount_cents integer not null check(amount_cents>0),
  label text not null,
  event_id uuid references public.events(id) on delete set null,
  household_payment_id uuid unique references public.household_payments(id) on delete set null,
  payment_method text not null check(payment_method in ('bank_transfer','card','cash','personal_advance')),
  advanced_by uuid references public.profiles(id) on delete set null,
  status text not null default 'settled' check(status in ('pending','settled','cancelled')),
  note text,
  receipt_storage_provider text,
  receipt_storage_path text,
  receipt_file_name text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  settled_by uuid references public.profiles(id) on delete set null,
  settled_at timestamptz
);

create or replace function private.user_household_id() returns uuid language sql stable security definer set search_path=public as $$
  select hm.household_id from public.household_members hm where hm.user_id=auth.uid() limit 1;
$$;

-- Initialisation : un foyer individuel pour tout compte existant qui n'en possède pas encore.
do $$ declare p record; h uuid; begin
  for p in select id,full_name,email,is_amicaliste,membership_valid_until from public.profiles loop
    if not exists(select 1 from public.household_members where user_id=p.id) then
      insert into public.households(name,created_by) values(coalesce(nullif(trim(p.full_name),''),'Foyer'),p.id) returning id into h;
      insert into public.household_members(household_id,user_id,display_name,member_type) values(h,p.id,coalesce(nullif(trim(p.full_name),''),coalesce(p.email,'Utilisateur')),'adult');
    end if;
    if p.is_amicaliste=true and p.membership_valid_until is null then
      update public.profiles set membership_valid_until=(current_date+interval '1 year'-interval '1 day')::date where id=p.id;
    end if;
  end loop;
end $$;

create or replace function private.ensure_profile_household() returns trigger language plpgsql security definer set search_path=public as $$
declare h uuid; begin
  if exists(select 1 from public.household_members where user_id=new.id) then return new; end if;
  insert into public.households(name,created_by) values(coalesce(nullif(trim(new.full_name),''),'Foyer'),new.id) returning id into h;
  insert into public.household_members(household_id,user_id,display_name,member_type) values(h,new.id,coalesce(nullif(trim(new.full_name),''),coalesce(new.email,'Utilisateur')),'adult');
  return new;
end $$;
drop trigger if exists profiles_ensure_household on public.profiles;
create trigger profiles_ensure_household after insert on public.profiles for each row execute function private.ensure_profile_household();

create or replace function private.sync_household_member_name() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.full_name is distinct from old.full_name then update public.household_members set display_name=coalesce(nullif(trim(new.full_name),''),coalesce(new.email,'Utilisateur')),updated_at=now() where user_id=new.id; end if;
  return new;
end $$;
drop trigger if exists profiles_sync_household_name on public.profiles;
create trigger profiles_sync_household_name after update of full_name on public.profiles for each row execute function private.sync_household_member_name();

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_charges enable row level security;
alter table public.household_payments enable row level security;
alter table public.household_payment_allocations enable row level security;
alter table public.membership_subscriptions enable row level security;
alter table public.association_settings enable row level security;
alter table public.treasury_entries enable row level security;

drop policy if exists "admins manage households" on public.households;
create policy "admins manage households" on public.households for all to authenticated using(private.is_admin()) with check(private.is_admin());
drop policy if exists "household members read household" on public.households;
create policy "household members read household" on public.households for select to authenticated using(private.is_admin() or id=private.user_household_id());
drop policy if exists "admins manage household members" on public.household_members;
create policy "admins manage household members" on public.household_members for all to authenticated using(private.is_admin()) with check(private.is_admin());
drop policy if exists "household members read members" on public.household_members;
create policy "household members read members" on public.household_members for select to authenticated using(private.is_admin() or household_id=private.user_household_id());
drop policy if exists "admins manage charges" on public.household_charges;
create policy "admins manage charges" on public.household_charges for all to authenticated using(private.is_admin()) with check(private.is_admin());
drop policy if exists "household members read charges" on public.household_charges;
create policy "household members read charges" on public.household_charges for select to authenticated using(private.is_admin() or household_id=private.user_household_id());
drop policy if exists "admins manage payments" on public.household_payments;
create policy "admins manage payments" on public.household_payments for all to authenticated using(private.is_admin()) with check(private.is_admin());
drop policy if exists "household members read payments" on public.household_payments;
create policy "household members read payments" on public.household_payments for select to authenticated using(private.is_admin() or household_id=private.user_household_id());
drop policy if exists "admins manage allocations" on public.household_payment_allocations;
create policy "admins manage allocations" on public.household_payment_allocations for all to authenticated using(private.is_admin()) with check(private.is_admin());
drop policy if exists "household members read allocations" on public.household_payment_allocations;
create policy "household members read allocations" on public.household_payment_allocations for select to authenticated using(private.is_admin() or exists(select 1 from public.household_payments p where p.id=payment_id and p.household_id=private.user_household_id()));
drop policy if exists "admins manage subscriptions" on public.membership_subscriptions;
create policy "admins manage subscriptions" on public.membership_subscriptions for all to authenticated using(private.is_admin()) with check(private.is_admin());
drop policy if exists "members read own household subscriptions" on public.membership_subscriptions;
create policy "members read own household subscriptions" on public.membership_subscriptions for select to authenticated using(private.is_admin() or household_id=private.user_household_id());
drop policy if exists "active members read association settings" on public.association_settings;
create policy "active members read association settings" on public.association_settings for select to authenticated using(private.is_active_member());
drop policy if exists "admins manage association settings" on public.association_settings;
create policy "admins manage association settings" on public.association_settings for all to authenticated using(private.is_admin()) with check(private.is_admin());
drop policy if exists "admins manage treasury" on public.treasury_entries;
create policy "admins manage treasury" on public.treasury_entries for all to authenticated using(private.is_admin()) with check(private.is_admin());

create or replace function private.activate_paid_memberships(p_payment_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare s record; begin
  for s in select ms.*,c.amount_cents charge_amount from public.membership_subscriptions ms join public.household_charges c on c.id=ms.charge_id join public.household_payment_allocations a on a.charge_id=c.id where a.payment_id=p_payment_id and ms.status='pending' loop
    if (select coalesce(sum(a2.amount_cents),0) from public.household_payment_allocations a2 join public.household_payments p2 on p2.id=a2.payment_id where a2.charge_id=s.charge_id and p2.status='confirmed')>=s.charge_amount then
      update public.membership_subscriptions set status='paid',activated_at=now() where id=s.id;
      update public.profiles set is_amicaliste=true,membership_valid_until=greatest(coalesce(membership_valid_until,current_date),s.ends_on),updated_at=now() where id=s.user_id;
    end if;
  end loop;
end $$;

create or replace function public.request_membership_subscription() returns table(subscription_id uuid,charge_id uuid,amount_cents integer,starts_on date,ends_on date) language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); h uuid:=private.user_household_id(); p public.profiles%rowtype; fee integer; s date; e date; sid uuid; cid uuid; existing public.membership_subscriptions%rowtype; begin
  if u is null or not private.is_active_member() or h is null then raise exception 'Accès non autorisé.'; end if;
  select * into existing from public.membership_subscriptions where user_id=u and status='pending' order by created_at desc limit 1;
  if found then return query select existing.id,existing.charge_id,existing.amount_cents,existing.starts_on,existing.ends_on; return; end if;
  select * into p from public.profiles where id=u;
  if p.is_amicaliste=true and p.membership_valid_until is not null and p.membership_valid_until>current_date+60 then raise exception 'Le renouvellement sera disponible 60 jours avant votre échéance.'; end if;
  select membership_fee_cents into fee from public.association_settings where id=1; fee:=coalesce(fee,6000);
  if p.is_amicaliste=true and p.membership_valid_until is not null and p.membership_valid_until>=current_date then s:=p.membership_valid_until+1; else s:=current_date; end if;
  e:=(s+interval '1 year'-interval '1 day')::date;
  insert into public.membership_subscriptions(user_id,household_id,starts_on,ends_on,amount_cents,status) values(u,h,s,e,fee,'pending') returning id into sid;
  insert into public.household_charges(household_id,user_id,category,label,amount_cents,created_by,metadata) values(h,u,'membership',format('Cotisation amicaliste %s → %s',to_char(s,'DD/MM/YYYY'),to_char(e,'DD/MM/YYYY')),fee,u,jsonb_build_object('membership_subscription_id',sid)) returning id into cid;
  update public.membership_subscriptions set charge_id=cid where id=sid;
  return query select sid,cid,fee,s,e;
end $$;

create or replace function public.prepare_household_payment(p_charge_ids uuid[] default null) returns table(payment_id uuid,reference text,amount_cents integer) language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); h uuid:=private.user_household_id(); total integer; pid uuid; ref text; begin
  if u is null or not private.is_active_member() or h is null then raise exception 'Accès non autorisé.'; end if;
  with r as (select c.id,c.amount_cents-coalesce(sum(a.amount_cents) filter(where p.status='confirmed'),0)::integer residual from public.household_charges c left join public.household_payment_allocations a on a.charge_id=c.id left join public.household_payments p on p.id=a.payment_id where c.household_id=h and c.status='open' and (p_charge_ids is null or c.id=any(p_charge_ids)) group by c.id,c.amount_cents) select coalesce(sum(greatest(residual,0)),0)::integer into total from r;
  if total<=0 then raise exception 'Aucune somme à régler pour cette sélection.'; end if;
  ref:='DANZ-'||to_char(current_date,'YY')||'-'||lpad(nextval('public.household_payment_reference_seq')::text,6,'0');
  insert into public.household_payments(household_id,amount_cents,method,status,reference,declared_by) values(h,total,'bank_transfer','prepared',ref,u) returning id into pid;
  insert into public.household_payment_allocations(payment_id,charge_id,amount_cents) select pid,id,residual from (select c.id,c.amount_cents-coalesce(sum(a.amount_cents) filter(where p.status='confirmed'),0)::integer residual from public.household_charges c left join public.household_payment_allocations a on a.charge_id=c.id left join public.household_payments p on p.id=a.payment_id where c.household_id=h and c.status='open' and (p_charge_ids is null or c.id=any(p_charge_ids)) group by c.id,c.amount_cents) q where residual>0;
  return query select pid,ref,total;
end $$;
create or replace function public.declare_household_payment(p_payment_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not private.is_active_member() then raise exception 'Accès non autorisé.'; end if;
  update public.household_payments set status='declared',declared_by=auth.uid(),declared_at=now() where id=p_payment_id and household_id=private.user_household_id() and status='prepared';
  if not found then raise exception 'Paiement introuvable ou déjà traité.'; end if;
end $$;
create or replace function public.confirm_household_payment(p_payment_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare p public.household_payments%rowtype; invalid boolean; begin
  if not private.is_admin() then raise exception 'Accès administrateur requis.'; end if;
  select * into p from public.household_payments where id=p_payment_id for update;
  if not found or p.status not in ('prepared','declared') then raise exception 'Paiement introuvable ou déjà traité.'; end if;
  select exists(select 1 from public.household_payment_allocations a join public.household_charges c on c.id=a.charge_id where a.payment_id=p_payment_id and a.amount_cents>c.amount_cents-coalesce((select sum(a2.amount_cents) from public.household_payment_allocations a2 join public.household_payments p2 on p2.id=a2.payment_id where a2.charge_id=c.id and p2.status='confirmed'),0)) into invalid;
  if invalid then raise exception 'Une charge a déjà été réglée par un autre paiement.'; end if;
  update public.household_payments set status='confirmed',confirmed_by=auth.uid(),confirmed_at=now(),declared_at=coalesce(declared_at,now()) where id=p_payment_id;
  insert into public.treasury_entries(kind,amount_cents,label,household_payment_id,payment_method,status,created_by,settled_by,settled_at) values('income',p.amount_cents,'Encaissement foyer · '||p.reference,p_payment_id,case when p.method='cash' then 'cash' else 'bank_transfer' end,'settled',auth.uid(),auth.uid(),now()) on conflict(household_payment_id) do nothing;
  perform private.activate_paid_memberships(p_payment_id);
end $$;
create or replace function public.admin_record_household_payment(p_household_id uuid,p_charge_ids uuid[],p_method text default 'cash',p_note text default null) returns uuid language plpgsql security definer set search_path=public as $$
declare total integer; pid uuid; ref text; begin
  if not private.is_admin() then raise exception 'Accès administrateur requis.'; end if;
  if p_method not in ('cash','bank_transfer') then raise exception 'Mode de paiement invalide.'; end if;
  with r as (select c.id,c.amount_cents-coalesce(sum(a.amount_cents) filter(where p.status='confirmed'),0)::integer residual from public.household_charges c left join public.household_payment_allocations a on a.charge_id=c.id left join public.household_payments p on p.id=a.payment_id where c.household_id=p_household_id and c.status='open' and c.id=any(p_charge_ids) group by c.id,c.amount_cents) select coalesce(sum(greatest(residual,0)),0)::integer into total from r;
  if total<=0 then raise exception 'Aucune somme à encaisser pour cette sélection.'; end if;
  ref:='DANZ-'||to_char(current_date,'YY')||'-'||lpad(nextval('public.household_payment_reference_seq')::text,6,'0');
  insert into public.household_payments(household_id,amount_cents,method,status,reference,note,declared_by,declared_at,confirmed_by,confirmed_at) values(p_household_id,total,p_method,'confirmed',ref,p_note,auth.uid(),now(),auth.uid(),now()) returning id into pid;
  insert into public.household_payment_allocations(payment_id,charge_id,amount_cents) select pid,id,residual from (select c.id,c.amount_cents-coalesce(sum(a.amount_cents) filter(where p.status='confirmed'),0)::integer residual from public.household_charges c left join public.household_payment_allocations a on a.charge_id=c.id left join public.household_payments p on p.id=a.payment_id where c.household_id=p_household_id and c.status='open' and c.id=any(p_charge_ids) group by c.id,c.amount_cents) q where residual>0;
  insert into public.treasury_entries(kind,amount_cents,label,household_payment_id,payment_method,status,note,created_by,settled_by,settled_at) values('income',total,'Encaissement foyer · '||ref,pid,p_method,'settled',p_note,auth.uid(),auth.uid(),now());
  perform private.activate_paid_memberships(pid); return pid;
end $$;
create or replace function public.admin_set_membership_status(p_user_id uuid,p_active boolean,p_valid_until date default null) returns void language plpgsql security definer set search_path=public as $$
declare v_until date; begin
  if not private.is_admin() then raise exception 'Accès administrateur requis.'; end if;
  if p_active then v_until:=coalesce(p_valid_until,(current_date+interval '1 year'-interval '1 day')::date); else v_until:=null; end if;
  update public.profiles set is_amicaliste=p_active,membership_valid_until=v_until,updated_at=now() where id=p_user_id;
  if not found then raise exception 'Utilisateur introuvable.'; end if;
  insert into public.admin_audit_log(actor_id,action,target_user_id,details) values(auth.uid(),'membership_status_updated',p_user_id,jsonb_build_object('active',p_active,'valid_until',v_until));
end $$;
create or replace function public.admin_update_profile_name(p_user_id uuid,p_full_name text) returns void language plpgsql security definer set search_path=public as $$
declare n text:=nullif(trim(p_full_name),''); begin
  if not private.is_admin() then raise exception 'Accès administrateur requis.'; end if;
  if n is null or length(n)>160 then raise exception 'Nom invalide.'; end if;
  update public.profiles set full_name=n,updated_at=now() where id=p_user_id;
  if not found then raise exception 'Utilisateur introuvable.'; end if;
  insert into public.admin_audit_log(actor_id,action,target_user_id,details) values(auth.uid(),'user_name_updated',p_user_id,jsonb_build_object('full_name',n));
end $$;
create or replace function public.admin_merge_households(p_source uuid,p_target uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not private.is_admin() then raise exception 'Accès administrateur requis.'; end if;
  if p_source is null or p_target is null or p_source=p_target then raise exception 'Foyers invalides.'; end if;
  update public.household_members set household_id=p_target,updated_at=now() where household_id=p_source;
  update public.household_charges set household_id=p_target where household_id=p_source;
  update public.household_payments set household_id=p_target where household_id=p_source;
  update public.membership_subscriptions set household_id=p_target where household_id=p_source;
  update public.poll_household_attendance set household_id=p_target where household_id=p_source;
  delete from public.households where id=p_source;
  insert into public.admin_audit_log(actor_id,action,details) values(auth.uid(),'households_merged',jsonb_build_object('source',p_source,'target',p_target));
end $$;

revoke all on function public.request_membership_subscription() from public,anon;
revoke all on function public.prepare_household_payment(uuid[]) from public,anon;
revoke all on function public.declare_household_payment(uuid) from public,anon;
revoke all on function public.confirm_household_payment(uuid) from public,anon;
revoke all on function public.admin_record_household_payment(uuid,uuid[],text,text) from public,anon;
revoke all on function public.admin_set_membership_status(uuid,boolean,date) from public,anon;
revoke all on function public.admin_update_profile_name(uuid,text) from public,anon;
revoke all on function public.admin_merge_households(uuid,uuid) from public,anon;
grant execute on function public.request_membership_subscription() to authenticated;
grant execute on function public.prepare_household_payment(uuid[]) to authenticated;
grant execute on function public.declare_household_payment(uuid) to authenticated;
grant execute on function public.confirm_household_payment(uuid) to authenticated;
grant execute on function public.admin_record_household_payment(uuid,uuid[],text,text) to authenticated;
grant execute on function public.admin_set_membership_status(uuid,boolean,date) to authenticated;
grant execute on function public.admin_update_profile_name(uuid,text) to authenticated;
grant execute on function public.admin_merge_households(uuid,uuid) to authenticated;
