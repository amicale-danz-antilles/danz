-- Ajout sans modification des écritures existantes.
create or replace function public.treasury_import_event_debt_list(p_event_id uuid,p_batch_id uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; person uuid; kind text; v_label text; n integer; seen text[]:='{}'; prior uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active and role='admin' and is_treasurer) then raise exception 'Accès trésorier requis'; end if;
 if p_event_id is null or p_batch_id is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'Lot invalide'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_event_id::text));
 select event_id into prior from public.treasury_event_batches where id=p_batch_id;
 if found then
  if prior<>p_event_id then raise exception 'Identifiant de lot déjà utilisé';end if;
  return public.treasury_assign_event_charges(p_event_id,p_batch_id,p_rows);
 end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  kind:=r->>'person_type';person:=(r->>'person_id')::uuid;v_label:=btrim(r->>'label');
  if kind is null or kind not in ('account','offline','child') or person is null or v_label is null or length(v_label) not between 1 and 180 or coalesce(r->>'category','')<>'activity' or coalesce(r->>'membership','')<>'false' or coalesce(jsonb_typeof(r->'amount_cents'),'')<>'number' or coalesce(r->>'amount_cents','') !~ '^[1-9][0-9]{0,8}$' then raise exception 'Ligne invalide';end if;
  n:=(r->>'amount_cents')::integer;
  if n>100000000 or (kind||':'||person::text)=any(seen) then raise exception 'Montant invalide ou personne en double';end if;
  seen:=array_append(seen,kind||':'||person::text);
  if exists(select 1 from public.household_charges c where c.event_id=p_event_id and c.status<>'cancelled' and lower(btrim(c.label))=lower(v_label) and ((kind='account' and (c.user_id=person or exists(select 1 from public.offline_people o where o.id=c.offline_person_id and o.linked_user_id=person))) or (kind='offline' and c.offline_person_id=person) or (kind='child' and c.household_member_id=person))) then raise exception 'Dette déjà présente pour cette personne, cet événement et ce libellé';end if;
 end loop;
 return public.treasury_assign_event_charges(p_event_id,p_batch_id,p_rows);
end $$;
revoke all on function public.treasury_import_event_debt_list(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.treasury_import_event_debt_list(uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';