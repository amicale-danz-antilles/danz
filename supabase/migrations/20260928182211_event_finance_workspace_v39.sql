alter table public.treasury_event_participants
  add column if not exists pricing_group text,
  add column if not exists price_cents integer not null default 0,
  add column if not exists charge_id uuid references public.household_charges(id) on delete set null,
  add column if not exists pricing_note text;

alter table public.treasury_event_participants
  drop constraint if exists treasury_event_participant_pricing_group,
  add constraint treasury_event_participant_pricing_group
    check (pricing_group is null or pricing_group in ('member','nonmember','child','guest')),
  drop constraint if exists treasury_event_participant_price_nonnegative,
  add constraint treasury_event_participant_price_nonnegative
    check (price_cents >= 0 and price_cents <= 100000000);

create unique index if not exists treasury_event_participant_charge_unique
  on public.treasury_event_participants(charge_id)
  where charge_id is not null;

with matched as (
  select distinct on (tep.id)
    tep.id participant_id,
    c.id charge_id,
    c.amount_cents,
    case
      when tep.household_member_id is not null then 'child'
      when coalesce(p.is_amicaliste,false) or coalesce(o.is_amicaliste,false) then 'member'
      else 'nonmember'
    end pricing_group
  from public.treasury_event_participants tep
  left join public.profiles p on p.id=tep.user_id
  left join public.offline_people o on o.id=tep.offline_person_id
  left join public.household_charges c
    on c.event_id=tep.event_id
   and c.status<>'cancelled'
   and c.category<>'membership'
   and (
     (tep.user_id is not null and c.user_id=tep.user_id) or
     (tep.offline_person_id is not null and c.offline_person_id=tep.offline_person_id) or
     (tep.household_member_id is not null and c.household_member_id=tep.household_member_id)
   )
  order by tep.id,c.created_at,c.id
)
update public.treasury_event_participants tep
set charge_id=coalesce(tep.charge_id,m.charge_id),
    price_cents=case when tep.price_cents=0 and m.charge_id is not null then m.amount_cents else tep.price_cents end,
    pricing_group=coalesce(tep.pricing_group,m.pricing_group)
from matched m
where m.participant_id=tep.id;

update public.treasury_event_participants tep
set pricing_group=case
  when tep.household_member_id is not null then 'child'
  when exists(select 1 from public.profiles p where p.id=tep.user_id and p.is_amicaliste=true) then 'member'
  when exists(select 1 from public.offline_people o where o.id=tep.offline_person_id and o.is_amicaliste=true) then 'member'
  else 'nonmember'
end
where tep.pricing_group is null;

create or replace function public.treasury_event_set_participant_finance(
  p_event_id uuid,
  p_person_type text,
  p_person_id uuid,
  p_pricing_group text,
  p_price_cents integer,
  p_label text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_actor uuid := auth.uid();
  v_event_title text;
  v_household uuid;
  v_user uuid;
  v_offline uuid;
  v_child uuid;
  v_participant uuid;
  v_charge uuid;
  v_current_amount integer;
  v_paid integer := 0;
  v_label text;
begin
  if v_actor is null or not private.is_treasurer() then raise exception 'Réservé au trésorier.'; end if;
  if p_event_id is null or p_person_id is null then raise exception 'Participant invalide.'; end if;
  if p_pricing_group not in ('member','nonmember','child','guest') then raise exception 'Statut tarifaire invalide.'; end if;
  if p_price_cents is null or p_price_cents < 0 or p_price_cents > 100000000 then raise exception 'Montant invalide.'; end if;

  select e.title into v_event_title from public.events e where e.id=p_event_id;
  if not found then raise exception 'Événement introuvable.'; end if;

  if p_person_type='account' then
    select m.household_id into v_household from public.profiles p
    join public.household_members m on m.user_id=p.id
    where p.id=p_person_id and p.active=true limit 1;
    v_user := p_person_id;
  elsif p_person_type='offline' then
    select o.household_id into v_household from public.offline_people o
    where o.id=p_person_id and o.linked_user_id is null;
    v_offline := p_person_id;
  elsif p_person_type='child' then
    select m.household_id into v_household from public.household_members m
    where m.id=p_person_id and m.member_type='child';
    v_child := p_person_id;
    if p_pricing_group<>'child' then raise exception 'Une fiche enfant doit utiliser le tarif enfant.'; end if;
  else
    raise exception 'Type de participant inconnu.';
  end if;
  if v_household is null then raise exception 'Rattachez cette personne à un foyer avant de la facturer.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_event_id::text||':'||p_person_type||':'||p_person_id::text));

  select tep.id,tep.charge_id into v_participant,v_charge
  from public.treasury_event_participants tep
  where tep.event_id=p_event_id and (
    (v_user is not null and tep.user_id=v_user) or
    (v_offline is not null and tep.offline_person_id=v_offline) or
    (v_child is not null and tep.household_member_id=v_child)
  ) for update;

  if v_participant is null then
    insert into public.treasury_event_participants(
      event_id,user_id,offline_person_id,household_member_id,created_by,pricing_group,price_cents
    ) values (
      p_event_id,v_user,v_offline,v_child,v_actor,p_pricing_group,p_price_cents
    ) returning id into v_participant;
  end if;

  if v_charge is null then
    select c.id into v_charge from public.household_charges c
    where c.event_id=p_event_id and c.status<>'cancelled' and c.category<>'membership'
      and ((v_user is not null and c.user_id=v_user)
        or (v_offline is not null and c.offline_person_id=v_offline)
        or (v_child is not null and c.household_member_id=v_child))
    order by c.created_at,c.id limit 1 for update;
  end if;

  v_label := coalesce(nullif(btrim(p_label),''),'Participation · '||v_event_title);
  if char_length(v_label)>180 then raise exception 'Libellé trop long.'; end if;

  if v_charge is not null then
    select c.amount_cents into v_current_amount from public.household_charges c where c.id=v_charge for update;
    select coalesce(sum(a.amount_cents),0)::integer into v_paid
    from public.household_payment_allocations a
    join public.household_payments hp on hp.id=a.payment_id and hp.status='confirmed'
    where a.charge_id=v_charge;

    if v_paid>0 and p_price_cents<>v_current_amount then
      raise exception 'Cette participation a déjà été payée : son montant ne peut plus être modifié.';
    end if;

    if p_price_cents=0 and v_paid=0 then
      update public.household_charges
      set status='cancelled',cancelled_by=v_actor,cancelled_at=now(),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('event_pricing_cancelled',true)
      where id=v_charge;
      v_charge := null;
    elsif p_price_cents>0 and v_paid=0 then
      update public.household_charges
      set amount_cents=p_price_cents,label=v_label,category='activity',
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'event_pricing_source','participant','event_pricing_group',p_pricing_group
          )
      where id=v_charge;
    end if;
  elsif p_price_cents>0 then
    insert into public.household_charges(
      household_id,user_id,offline_person_id,household_member_id,event_id,
      category,label,amount_cents,created_by,metadata
    ) values (
      v_household,v_user,v_offline,v_child,p_event_id,'activity',v_label,p_price_cents,v_actor,
      jsonb_build_object('event_pricing_source','participant','event_pricing_group',p_pricing_group)
    ) returning id into v_charge;
  end if;

  update public.treasury_event_participants
  set pricing_group=p_pricing_group,price_cents=p_price_cents,charge_id=v_charge,
      pricing_note=case when p_price_cents=0 then 'Gratuit' else null end
  where id=v_participant;

  insert into public.admin_audit_log(actor_id,action,details)
  values(v_actor,'treasury_event_participant_priced',jsonb_build_object(
    'event_id',p_event_id,'participant_id',v_participant,'person_type',p_person_type,
    'person_id',p_person_id,'pricing_group',p_pricing_group,'price_cents',p_price_cents,'charge_id',v_charge
  ));

  return jsonb_build_object('participant_id',v_participant,'charge_id',v_charge,'price_cents',p_price_cents);
end;
$function$;

revoke execute on function public.treasury_event_set_participant_finance(uuid,text,uuid,text,integer,text) from public,anon;
grant execute on function public.treasury_event_set_participant_finance(uuid,text,uuid,text,integer,text) to authenticated;

create or replace function public.treasury_event_create_guest(
  p_event_id uuid,
  p_name text,
  p_email text default null,
  p_pricing_group text default 'guest',
  p_price_cents integer default 0,
  p_label text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_actor uuid := auth.uid();
  v_person uuid;
  v_result jsonb;
begin
  if v_actor is null or not private.is_treasurer() then raise exception 'Réservé au trésorier.'; end if;
  if nullif(btrim(p_name),'') is null or char_length(btrim(p_name))>160 then raise exception 'Nom invalide.'; end if;
  if p_pricing_group not in ('member','nonmember','guest') then raise exception 'Statut tarifaire invalide.'; end if;
  v_person := public.admin_create_offline_person(btrim(p_name),nullif(btrim(p_email),''),'Créé depuis la trésorerie événementielle');
  v_result := public.treasury_event_set_participant_finance(p_event_id,'offline',v_person,p_pricing_group,p_price_cents,p_label);
  return v_result || jsonb_build_object('person_id',v_person);
end;
$function$;

revoke execute on function public.treasury_event_create_guest(uuid,text,text,text,integer,text) from public,anon;
grant execute on function public.treasury_event_create_guest(uuid,text,text,text,integer,text) to authenticated;
