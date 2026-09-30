CREATE OR REPLACE FUNCTION public.treasury_import_edited_entries(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_item jsonb; v_entry public.treasury_entries%rowtype;
 v_current jsonb; v_next jsonb;
 v_uuid uuid; v_user uuid; v_offline uuid;
 v_person text; v_date date; v_amount numeric;
 v_count integer:=0; v_seen uuid[]:=array[]::uuid[];
begin
 if auth.uid() is null or not private.is_treasurer() then raise exception 'Accès trésorier requis.'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>500 then
   raise exception 'Import invalide : 500 écritures maximum.';
 end if;
 for v_item in select value from jsonb_array_elements(p_rows) loop
   v_uuid := (v_item->>'id')::uuid;
   if v_uuid = any(v_seen) then raise exception 'Écriture dupliquée dans l’import : %',v_uuid; end if;
   v_seen:=array_append(v_seen,v_uuid);
   select * into v_entry from public.treasury_entries where id=v_uuid for update;
   if not found or v_entry.kind not in ('income','expense') or v_entry.status='cancelled'
      or v_entry.household_payment_id is not null
      or (v_entry.payment_method='personal_advance' and (v_entry.status<>'pending' or v_entry.kind<>'expense'))
      then raise exception 'L’écriture % est absente ou protégée.',v_uuid;
   end if;
   v_person:=case when v_entry.payment_method='personal_advance' then
     case when v_entry.advanced_by_offline is not null then 'offline:'||v_entry.advanced_by_offline::text
          when v_entry.advanced_by is not null then 'user:'||v_entry.advanced_by::text else '' end
   else case when v_entry.beneficiary_offline_id is not null then 'offline:'||v_entry.beneficiary_offline_id::text
             when v_entry.beneficiary_user_id is not null then 'user:'||v_entry.beneficiary_user_id::text else '' end end;
   v_current:=jsonb_build_object(
     'id',v_entry.id::text,'kind',v_entry.kind,'status',v_entry.status,
     'label',coalesce(v_entry.label,''),'amountCents',v_entry.amount_cents,
     'category',coalesce(v_entry.category,''),'account',v_entry.payment_method,
     'occurredOn',(v_entry.occurred_at at time zone 'UTC')::date::text,
     'note',coalesce(v_entry.note,''),'eventId',coalesce(v_entry.event_id::text,''),
     'person',coalesce(v_person,'')
   );
   if v_item->'baseline' is distinct from v_current then
      raise exception 'Écriture % modifiée depuis l’export : téléchargez un fichier récent.',v_uuid;
   end if;
   v_next:=v_item->'next';
   if jsonb_typeof(v_next) is distinct from 'object'
     or v_next->>'id' is distinct from v_entry.id::text
     or v_next->>'kind' is distinct from v_entry.kind
     or v_next->>'status' is distinct from v_entry.status then
       raise exception 'Identité, type ou statut invalide pour %.',v_uuid;
   end if;
   v_amount:=(v_next->>'amountCents')::numeric;
   if v_amount<=0 or v_amount>100000000 or v_amount<>trunc(v_amount) then
      raise exception 'Montant invalide pour %.',v_uuid;
   end if;
   v_date:=(v_next->>'occurredOn')::date;
   if v_date>current_date then raise exception 'Date future refusée.'; end if;
   if nullif(btrim(v_next->>'label'),'') is null or length(v_next->>'label')>250
      or length(coalesce(v_next->>'note',''))>2000
      or length(coalesce(v_next->>'category',''))>100 then
       raise exception 'Libellé ou texte invalide pour %.',v_uuid;
   end if;
   v_person:=coalesce(v_next->>'person','');v_user:=null;v_offline:=null;
   if v_person<>'' then
     if v_person~'^user:[0-9a-fA-F-]{36}$' then v_user:=substring(v_person from 6)::uuid;
     elsif v_person~'^offline:[0-9a-fA-F-]{36}$' then v_offline:=substring(v_person from 9)::uuid;
     else raise exception 'Identité de personne incorrecte pour %.',v_uuid; end if;
   end if;
   perform public.treasury_update_entry(
     v_uuid,v_next->>'label',coalesce(v_next->>'note',''),
     nullif(coalesce(v_next->>'category',''),''),v_next->>'account',
     v_user,v_offline,v_amount::integer,v_date,
     nullif(coalesce(v_next->>'eventId',''),'')::uuid
   );
   v_count:=v_count+1;
 end loop;
 if v_count>0 then insert into public.admin_audit_log(actor_id,action,details)
    values(auth.uid(),'treasury_excel_batch_import',jsonb_build_object('count',v_count,'entry_ids',to_jsonb(v_seen)));
 end if;
 return jsonb_build_object('updated',v_count);
end;
$function$;
revoke all on function public.treasury_import_edited_entries(jsonb) from public,anon;
grant execute on function public.treasury_import_edited_entries(jsonb) to authenticated;
