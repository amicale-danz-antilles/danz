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
  if p_pricing_group not in ('member','nonmember','guest','child') then raise exception 'Statut tarifaire invalide.'; end if;
  v_person := public.admin_create_offline_person(btrim(p_name),nullif(btrim(p_email),''),'Créé depuis la trésorerie événementielle');
  v_result := public.treasury_event_set_participant_finance(p_event_id,'offline',v_person,p_pricing_group,p_price_cents,p_label);
  return v_result || jsonb_build_object('person_id',v_person);
end;
$function$;

revoke execute on function public.treasury_event_create_guest(uuid,text,text,text,integer,text) from public,anon;
grant execute on function public.treasury_event_create_guest(uuid,text,text,text,integer,text) to authenticated;
