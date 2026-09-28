-- V34.1 : création atomique d'un participant depuis un événement et date comptable stable.
create or replace function public.treasury_event_create_participant(
  p_event_id uuid,
  p_name text,
  p_email text default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_person uuid;
  v_event_title text;
begin
  if v_actor is null or not private.is_treasurer() then
    raise exception 'Réservé au trésorier.';
  end if;
  select title into v_event_title from public.events where id=p_event_id;
  if not found then raise exception 'Événement introuvable.'; end if;

  v_person := public.admin_create_offline_person(p_name,p_email,p_notes);

  insert into public.treasury_event_participants(event_id,offline_person_id,created_by)
  values(p_event_id,v_person,v_actor);

  insert into public.admin_audit_log(actor_id,action,details)
  values(v_actor,'treasury_event_participant_created',
    jsonb_build_object('event_id',p_event_id,'event_title',v_event_title,'offline_person_id',v_person));
  return v_person;
end;
$$;
revoke all on function public.treasury_event_create_participant(uuid,text,text,text) from public,anon;
grant execute on function public.treasury_event_create_participant(uuid,text,text,text) to authenticated;

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
  if v_actor is null or not private.is_treasurer() then raise exception 'Réservé au trésorier.'; end if;
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
    (p_occurred_on + time '12:00') at time zone 'UTC',v_actor,v_actor,now()
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
