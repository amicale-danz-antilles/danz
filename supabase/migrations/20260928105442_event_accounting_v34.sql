-- V34 : comptabilité événementielle complète.
-- Toute écriture confirmée par événement alimente le grand livre existant.

create or replace function public.treasury_event_record_entry(
  p_event_id uuid,
  p_kind text,
  p_amount_cents integer,
  p_label text,
  p_method text,
  p_occurred_on date,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_title text;
begin
  if v_actor is null or not private.is_treasurer() then
    raise exception 'Réservé au trésorier.';
  end if;
  select title into v_title from public.events where id=p_event_id;
  if not found then raise exception 'Événement introuvable.'; end if;
  if p_kind not in ('income','expense') then raise exception 'Type d’écriture invalide.'; end if;
  if p_method not in ('cash','bank_transfer','card') then raise exception 'Choisissez Revolut ou la caisse espèces.'; end if;
  if p_amount_cents is null or p_amount_cents<=0 or p_amount_cents>100000000 then raise exception 'Montant invalide.'; end if;
  if nullif(btrim(p_label),'') is null or char_length(btrim(p_label))>250 then raise exception 'Libellé invalide.'; end if;
  if p_occurred_on is null or p_occurred_on>current_date then raise exception 'Date invalide.'; end if;
  if p_note is not null and char_length(p_note)>1000 then raise exception 'Note trop longue.'; end if;

  insert into public.treasury_entries(
    kind,amount_cents,label,event_id,payment_method,status,note,category,
    occurred_at,created_by,settled_by,settled_at
  ) values (
    p_kind,p_amount_cents,btrim(p_label),p_event_id,p_method,'settled',
    nullif(btrim(p_note),''),'evenement',
    p_occurred_on::timestamp at time zone 'UTC',v_actor,v_actor,now()
  ) returning id into v_id;

  insert into public.admin_audit_log(actor_id,action,details)
  values(v_actor,'treasury_event_entry_created',
    jsonb_build_object('entry_id',v_id,'event_id',p_event_id,'event_title',v_title,
      'kind',p_kind,'amount_cents',p_amount_cents,'payment_method',p_method));

  return v_id;
end;
$$;
revoke all on function public.treasury_event_record_entry(uuid,text,integer,text,text,date,text) from public,anon;
grant execute on function public.treasury_event_record_entry(uuid,text,integer,text,text,date,text) to authenticated;

create or replace function public.treasury_collect_event(
  p_event_id uuid, p_household_id uuid, p_charge_ids uuid[], p_method text
) returns uuid
language plpgsql security definer set search_path=''
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
    select count(distinct item.charge_id) from unnest(p_charge_ids) as item(charge_id)
  ) then raise exception 'La même dette figure plusieurs fois.'; end if;
  select title into v_title from public.events where id=p_event_id;
  if not found then raise exception 'Événement introuvable.'; end if;
  v_expected := array_length(p_charge_ids,1);
  select count(*) into v_valid from public.household_charges c
  where c.id=any(p_charge_ids) and c.status='open' and c.household_id=p_household_id
    and c.event_id=p_event_id;
  if v_valid<>v_expected then
    raise exception 'Certaines dettes ne correspondent pas à cet événement et à ce foyer.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_household_id::text));
  v_payment := public.admin_record_household_payment(
    p_household_id,p_charge_ids,p_method,
    'Événement : '||v_title||' · paiement confirmé par le trésorier'
  );

  update public.treasury_entries
     set event_id=p_event_id,category='evenement'
   where household_payment_id=v_payment;

  insert into public.admin_audit_log(actor_id,action,details)
  values(auth.uid(),'treasury_event_payment',
    jsonb_build_object('event_id',p_event_id,'household_id',p_household_id,
      'payment_id',v_payment,'method',p_method));
  return v_payment;
end;
$$;
revoke all on function public.treasury_collect_event(uuid,uuid,uuid[],text) from public,anon;
grant execute on function public.treasury_collect_event(uuid,uuid,uuid[],text) to authenticated;
