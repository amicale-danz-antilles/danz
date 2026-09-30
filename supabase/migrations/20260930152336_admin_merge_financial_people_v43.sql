CREATE OR REPLACE FUNCTION public.admin_merge_offline_people(p_source uuid, p_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_source public.offline_people%rowtype;
 v_target public.offline_people%rowtype;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Accès administrateur requis.'; end if;
 if p_source is null or p_target is null or p_source=p_target then raise exception 'Choisissez deux fiches différentes.'; end if;
 select * into v_source from public.offline_people where id=p_source for update;
 select * into v_target from public.offline_people where id=p_target for update;
 if v_source.id is null or v_target.id is null then raise exception 'Une fiche est introuvable.'; end if;
 if v_source.linked_user_id is not null or v_target.linked_user_id is not null then
   raise exception 'Une fiche liée à un compte doit être rapprochée depuis son compte utilisateur.';
 end if;
 if exists(
   select 1 from public.treasury_event_participants s
   join public.treasury_event_participants t on t.event_id=s.event_id
   where s.offline_person_id=p_source and t.offline_person_id=p_target
 ) then raise exception 'Les deux fiches sont inscrites au même événement : corrigez ce doublon de participation avant la fusion.'; end if;
 if v_source.household_id is distinct from v_target.household_id and (
   exists(select 1 from public.offline_people where household_id=v_source.household_id and id<>p_source)
   or exists(select 1 from public.household_members where household_id=v_source.household_id and user_id is not null)
 ) then raise exception 'Le foyer source contient d’autres personnes. Fusionnez les foyers manuellement avant cette opération.'; end if;
 update public.household_charges set offline_person_id=p_target where offline_person_id=p_source;
 update public.membership_subscriptions set offline_person_id=p_target where offline_person_id=p_source;
 update public.treasury_entries set advanced_by_offline=p_target where advanced_by_offline=p_source;
 update public.treasury_entries set beneficiary_offline_id=p_target where beneficiary_offline_id=p_source;
 update public.treasury_event_participants set offline_person_id=p_target where offline_person_id=p_source;
 update public.offline_people set
   is_amicaliste=(v_target.is_amicaliste or v_source.is_amicaliste),
   membership_valid_until=greatest(v_target.membership_valid_until,v_source.membership_valid_until),
   email=coalesce(nullif(v_target.email,''),nullif(v_source.email,'')),
   notes=case when nullif(btrim(coalesce(v_source.notes,'')),'') is null then v_target.notes
         else concat_ws(E'\n',nullif(v_target.notes,''),'Fusion de '||v_source.display_name||' : '||v_source.notes) end,
   updated_at=now()
 where id=p_target;
 delete from public.offline_people where id=p_source;
 if v_source.household_id is distinct from v_target.household_id then
   perform public.admin_merge_households(v_source.household_id,v_target.household_id);
 end if;
 insert into public.admin_audit_log(actor_id,action,details)
 values(auth.uid(),'offline_people_merged',jsonb_build_object(
   'source_id',p_source,'source_name',v_source.display_name,'source_email',v_source.email,
   'target_id',p_target,'target_name',v_target.display_name,
   'source_household',v_source.household_id,'target_household',v_target.household_id
 ));
end;
$function$;
revoke all on function public.admin_merge_offline_people(uuid,uuid) from public,anon;
grant execute on function public.admin_merge_offline_people(uuid,uuid) to authenticated;
