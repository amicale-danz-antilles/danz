-- V4 : un suivi nominatif des participants et des dettes pour chaque événement.
-- Aucune suppression ni modification des écritures financières existantes.

create table if not exists public.treasury_event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete restrict,
  offline_person_id uuid references public.offline_people(id) on delete restrict,
  household_member_id uuid references public.household_members(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint treasury_event_one_person check (num_nonnulls(user_id,offline_person_id,household_member_id)=1)
);
create unique index if not exists treasury_event_user_unique on public.treasury_event_participants(event_id,user_id) where user_id is not null;
create unique index if not exists treasury_event_offline_unique on public.treasury_event_participants(event_id,offline_person_id) where offline_person_id is not null;
create unique index if not exists treasury_event_child_unique on public.treasury_event_participants(event_id,household_member_id) where household_member_id is not null;
create index if not exists treasury_event_participants_event_idx on public.treasury_event_participants(event_id);
alter table public.treasury_event_participants enable row level security;
revoke all on public.treasury_event_participants from anon, authenticated;
grant select on public.treasury_event_participants to authenticated;
drop policy if exists "treasurer reads event participants" on public.treasury_event_participants;
create policy "treasurer reads event participants" on public.treasury_event_participants
  for select to authenticated using ((select private.is_treasurer()));

-- Clé idempotente : un double clic ou une relance réseau ne doit pas refacturer.
create table if not exists public.treasury_event_batches (
  id uuid primary key,
  event_id uuid not null references public.events(id),
  created_by uuid not null references public.profiles(id),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.treasury_event_batches enable row level security;
revoke all on public.treasury_event_batches from anon, authenticated;
grant select on public.treasury_event_batches to authenticated;
drop policy if exists "treasurer reads event batches" on public.treasury_event_batches;
create policy "treasurer reads event batches" on public.treasury_event_batches
  for select to authenticated using ((select private.is_treasurer()));

create or replace function public.treasury_assign_event_charges(
  p_event_id uuid, p_batch_id uuid, p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_event public.events%rowtype;
  v_row jsonb;
  v_kind text;
  v_person uuid;
  v_household uuid;
  v_user uuid;
  v_offline uuid;
  v_child uuid;
  v_amount integer;
  v_label text;
  v_category text;
  v_membership boolean;
  v_fee integer;
  v_start date;
  v_end date;
  v_profile public.profiles%rowtype;
  v_offline_person public.offline_people%rowtype;
  v_subscription uuid;
  v_charge uuid;
  v_existing uuid;
  v_existing_meta jsonb;
  v_count integer := 0;
  v_charges integer := 0;
  v_memberships integer := 0;
  v_result jsonb;
begin
  if v_actor is null or not private.is_treasurer() then
    raise exception 'Seul le trésorier titulaire peut affecter les dettes.';
  end if;
  if p_event_id is null or p_batch_id is null or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Sélection d’événement ou de participants invalide.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_event_id::text));
  select * into v_event from public.events where id=p_event_id;
  if not found then raise exception 'Événement introuvable.'; end if;
  select b.result into v_result from public.treasury_event_batches b where b.id=p_batch_id;
  if found then return v_result; end if;
  select coalesce(membership_fee_cents,6000) into v_fee from public.association_settings where id=1;
  v_fee := coalesce(v_fee,6000);
  if v_fee <= 0 then raise exception 'Le tarif de cotisation est invalide.'; end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_kind := v_row->>'person_type';
    v_person := (v_row->>'person_id')::uuid;
    v_amount := coalesce((v_row->>'amount_cents')::integer,0);
    v_category := coalesce(nullif(btrim(v_row->>'category'),''),'activity');
    v_label := coalesce(nullif(btrim(v_row->>'label'),''),v_event.title);
    v_membership := coalesce((v_row->>'membership')::boolean,false);
    v_household := null; v_user := null; v_offline := null; v_child := null;

    if v_person is null or v_amount not between 0 and 100000000
       or char_length(v_label)>180 or v_category not in ('meal','drinks','activity','other','adjustment') then
      raise exception 'Ligne de participant invalide.';
    end if;
    if v_kind='account' then
      select p.* into v_profile from public.profiles p where p.id=v_person and p.active=true;
      if not found then raise exception 'Compte actif introuvable.'; end if;
      select m.household_id into v_household from public.household_members m where m.user_id=v_person limit 1;
      v_user := v_person;
    elsif v_kind='offline' then
      select o.* into v_offline_person from public.offline_people o where o.id=v_person and o.linked_user_id is null;
      if not found then raise exception 'Fiche sans compte introuvable ou déjà associée.'; end if;
      v_household := v_offline_person.household_id;
      v_offline := v_person;
    elsif v_kind='child' then
      select m.household_id into v_household from public.household_members m where m.id=v_person and m.member_type='child';
      if v_membership then raise exception 'Une cotisation nominative ne peut pas être facturée à une fiche enfant.'; end if;
      v_child := v_person;
    else
      raise exception 'Type de personne inconnu.';
    end if;
    if v_household is null then raise exception 'Rattachez d’abord cette personne à un foyer.'; end if;

    if not exists (
      select 1 from public.treasury_event_participants t
      where t.event_id=p_event_id and
        ((v_user is not null and t.user_id=v_user) or
         (v_offline is not null and t.offline_person_id=v_offline) or
         (v_child is not null and t.household_member_id=v_child))
    ) then
      insert into public.treasury_event_participants(event_id,user_id,offline_person_id,household_member_id,created_by)
      values(p_event_id,v_user,v_offline,v_child,v_actor);
    end if;
    v_count := v_count+1;

    if v_amount>0 then
      insert into public.household_charges(
        household_id,user_id,offline_person_id,household_member_id,event_id,
        category,label,amount_cents,created_by,metadata
      ) values (
        v_household,v_user,v_offline,v_child,p_event_id,
        v_category,v_label,v_amount,v_actor,
        jsonb_build_object('event_finance_batch_id',p_batch_id,
          'event_finance_person_type',v_kind,'event_finance_person_id',v_person)
      );
      v_charges := v_charges+1;
    end if;

    if v_membership then
      if v_user is not null then
        if v_profile.is_amicaliste and v_profile.membership_valid_until > current_date+60 then
          raise exception 'Cotisation déjà à jour : renouvelez à moins de 60 jours de l’échéance.';
        end if;
        select s.charge_id into v_existing from public.membership_subscriptions s
          where s.user_id=v_user and s.status='pending'
          order by s.created_at desc limit 1 for update;
        if v_existing is not null then
          update public.household_charges set event_id=coalesce(event_id,p_event_id)
            where id=v_existing and household_id=v_household;
          v_memberships := v_memberships+1;
        else
          if v_profile.is_amicaliste and v_profile.membership_valid_until >= current_date then
            v_start := v_profile.membership_valid_until+1;
          else
            v_start := current_date;
          end if;
          v_end := (v_start+interval '1 year'-interval '1 day')::date;
          insert into public.membership_subscriptions(user_id,household_id,starts_on,ends_on,amount_cents,status)
            values(v_user,v_household,v_start,v_end,v_fee,'pending')
            returning id into v_subscription;
          insert into public.household_charges(household_id,user_id,event_id,category,label,amount_cents,created_by,metadata)
            values(v_household,v_user,p_event_id,'membership',
              'Cotisation amicaliste '||to_char(v_start,'DD/MM/YYYY')||' → '||to_char(v_end,'DD/MM/YYYY'),
              v_fee,v_actor,
              jsonb_build_object('membership_subscription_id',v_subscription,'event_finance_batch_id',p_batch_id))
            returning id into v_charge;
          update public.membership_subscriptions set charge_id=v_charge where id=v_subscription;
          v_charges := v_charges+1; v_memberships := v_memberships+1;
        end if;
      elsif v_offline is not null then
        if v_offline_person.is_amicaliste and v_offline_person.membership_valid_until > current_date+60 then
          raise exception 'Cotisation déjà à jour : renouvelez à moins de 60 jours de l’échéance.';
        end if;
        select c.id into v_existing
        from public.household_charges c
        where c.offline_person_id=v_offline and c.category='membership' and c.status='open'
          and c.metadata ? 'offline_membership_end'
          and c.amount_cents > coalesce((
            select sum(a.amount_cents) from public.household_payment_allocations a
            join public.household_payments p on p.id=a.payment_id
            where a.charge_id=c.id and p.status='confirmed'),0)
        order by c.created_at desc limit 1 for update;
        if v_existing is not null then
          update public.household_charges set event_id=coalesce(event_id,p_event_id) where id=v_existing;
          v_memberships := v_memberships+1;
        else
          if v_offline_person.is_amicaliste and v_offline_person.membership_valid_until >= current_date then
            v_start := v_offline_person.membership_valid_until+1;
          else
            v_start := current_date;
          end if;
          v_end := (v_start+interval '1 year'-interval '1 day')::date;
          insert into public.household_charges(
            household_id,offline_person_id,event_id,category,label,amount_cents,created_by,metadata)
            values(v_household,v_offline,p_event_id,'membership',
              'Cotisation amicaliste '||to_char(v_start,'DD/MM/YYYY')||' → '||to_char(v_end,'DD/MM/YYYY'),
              v_fee,v_actor,
              jsonb_build_object('offline_membership_start',v_start,'offline_membership_end',v_end,
                                 'event_finance_batch_id',p_batch_id))
            returning id into v_charge;
          v_charges := v_charges+1; v_memberships := v_memberships+1;
        end if;
      end if;
    end if;
    v_existing := null;
  end loop;
  v_result := jsonb_build_object('participants',v_count,'new_charges',v_charges,'memberships',v_memberships);
  insert into public.treasury_event_batches(id,event_id,created_by,result)
    values(p_batch_id,p_event_id,v_actor,v_result);
  insert into public.admin_audit_log(actor_id,action,details)
    values(v_actor,'treasury_event_assigned',
      jsonb_build_object('event_id',p_event_id,'batch_id',p_batch_id,'participants',v_count,'new_charges',v_charges));
  return v_result;
end;
$$;
revoke all on function public.treasury_assign_event_charges(uuid,uuid,jsonb) from public, anon;
grant execute on function public.treasury_assign_event_charges(uuid,uuid,jsonb) to authenticated;

-- Une cotisation d'une personne sans compte est activée uniquement APRÈS paiement confirmé,
-- même si le paiement est confirmé ultérieurement (virement bancaire).
create or replace function private.activate_offline_membership(p_charge_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_charge public.household_charges%rowtype;
  v_paid bigint;
  v_until date;
  v_linked_user uuid;
begin
  select * into v_charge from public.household_charges
  where id=p_charge_id and status='open' and category='membership'
    and offline_person_id is not null and metadata ? 'offline_membership_end';
  if not found then return; end if;
  select coalesce(sum(a.amount_cents),0) into v_paid
    from public.household_payment_allocations a
    join public.household_payments p on p.id=a.payment_id
    where a.charge_id=p_charge_id and p.status='confirmed';
  if v_paid < v_charge.amount_cents then return; end if;
  v_until := (v_charge.metadata->>'offline_membership_end')::date;
  update public.offline_people
     set is_amicaliste=true, membership_valid_until=greatest(coalesce(membership_valid_until,v_until),v_until),
         updated_at=now()
     where id=v_charge.offline_person_id
     returning linked_user_id into v_linked_user;
  if v_linked_user is not null then
    update public.profiles
      set is_amicaliste=true,membership_valid_until=greatest(coalesce(membership_valid_until,v_until),v_until),
          updated_at=now()
      where id=v_linked_user;
  end if;
end;
$$;
revoke all on function private.activate_offline_membership(uuid) from public, anon, authenticated;

create or replace function private.offline_membership_on_allocation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists(select 1 from public.household_payments where id=new.payment_id and status='confirmed') then
    perform private.activate_offline_membership(new.charge_id);
  end if;
  return new;
end;
$$;
revoke all on function private.offline_membership_on_allocation() from public, anon, authenticated;
drop trigger if exists offline_membership_allocation_confirmed on public.household_payment_allocations;
create trigger offline_membership_allocation_confirmed
after insert on public.household_payment_allocations for each row
execute function private.offline_membership_on_allocation();

create or replace function private.offline_membership_on_payment_confirmed()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if new.status='confirmed' and old.status is distinct from new.status then
    for v_id in select charge_id from public.household_payment_allocations where payment_id=new.id
    loop
      perform private.activate_offline_membership(v_id);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.offline_membership_on_payment_confirmed() from public, anon, authenticated;
drop trigger if exists offline_membership_payment_confirmed on public.household_payments;
create trigger offline_membership_payment_confirmed after update of status
on public.household_payments for each row
execute function private.offline_membership_on_payment_confirmed();

-- Encaisser un événement foyer par foyer, en sélectionnant les charges précises.
-- La fonction existante enregistre UN paiement, UN revenu et active les abonnements.
create or replace function public.treasury_collect_event(
  p_event_id uuid, p_household_id uuid, p_charge_ids uuid[], p_method text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_expected integer;
  v_valid integer;
  v_payment uuid;
  v_title text;
begin
  if auth.uid() is null or not private.is_treasurer() then
    raise exception 'Réservé au trésorier.';
  end if;
  if p_method not in ('cash','bank_transfer') or array_length(p_charge_ids,1) is null
     or array_length(p_charge_ids,1)>100 then
    raise exception 'Paiement invalide.';
  end if;
  if array_length(p_charge_ids,1)<>(
    select count(distinct id) from unnest(p_charge_ids) as id
  ) then raise exception 'La même dette figure plusieurs fois.'; end if;
  select title into v_title from public.events where id=p_event_id;
  if not found then raise exception 'Événement introuvable.'; end if;
  v_expected := array_length(p_charge_ids,1);
  select count(*) into v_valid from public.household_charges c
  where c.id=any(p_charge_ids) and c.status='open' and c.household_id=p_household_id
    and (
      c.event_id=p_event_id
      or (c.category='membership' and exists(
        select 1 from public.treasury_event_participants t
        where t.event_id=p_event_id
          and ((t.user_id is not null and t.user_id=c.user_id)
            or (t.offline_person_id is not null and t.offline_person_id=c.offline_person_id))
      ))
    );
  if v_valid<>v_expected then raise exception 'Certaines dettes ne correspondent pas à cet événement et à ce foyer.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_household_id::text));
  v_payment := public.admin_record_household_payment(p_household_id,p_charge_ids,p_method,
    'Événement : '||v_title||' · paiement confirmé par le trésorier');
  insert into public.admin_audit_log(actor_id,action,details)
    values(auth.uid(),'treasury_event_payment',
      jsonb_build_object('event_id',p_event_id,'household_id',p_household_id,
        'payment_id',v_payment,'method',p_method));
  return v_payment;
end;
$$;
revoke all on function public.treasury_collect_event(uuid,uuid,uuid[],text) from public, anon;
grant execute on function public.treasury_collect_event(uuid,uuid,uuid[],text) to authenticated;
