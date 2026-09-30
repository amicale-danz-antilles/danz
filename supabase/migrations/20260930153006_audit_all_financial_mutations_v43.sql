CREATE OR REPLACE FUNCTION private.audit_financial_mutation_v43()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_before jsonb;
 v_after jsonb;
 v_fields jsonb;
 v_record_id text;
begin
 v_before:=case when tg_op='INSERT' then null else to_jsonb(old) end;
 v_after:=case when tg_op='DELETE' then null else to_jsonb(new) end;
 if tg_op='UPDATE' and v_before=v_after then return new; end if;
 v_fields:=case when tg_op='UPDATE' then (
   select coalesce(jsonb_agg(key order by key),'[]'::jsonb) from (
     select key from jsonb_object_keys(v_after) as key
     where v_before->key is distinct from v_after->key
   ) keys
 ) else '[]'::jsonb end;
 v_record_id:=coalesce(v_after->>'id',v_before->>'id','1');
 insert into public.admin_audit_log(actor_id,action,details)
 values(auth.uid(),'ledger_'||tg_table_name||'_'||lower(tg_op),
   jsonb_build_object(
     'record_id',v_record_id,'table',tg_table_name,
     'changed_fields',v_fields,
     'before',v_before-'receipt_storage_path'-'receipt_file_name'-'email'-'notes'-'iban'-'bic',
     'after',v_after-'receipt_storage_path'-'receipt_file_name'-'email'-'notes'-'iban'-'bic'
   ));
 return case when tg_op='DELETE' then old else new end;
end;
$function$;
revoke all on function private.audit_financial_mutation_v43() from public,anon,authenticated;
CREATE TRIGGER ledger_events_v43 AFTER INSERT OR DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION private.audit_financial_mutation_v43();
CREATE TRIGGER ledger_household_charges_v43 AFTER INSERT OR DELETE OR UPDATE ON public.household_charges FOR EACH ROW EXECUTE FUNCTION private.audit_financial_mutation_v43();
CREATE TRIGGER ledger_household_payments_v43 AFTER INSERT OR DELETE OR UPDATE ON public.household_payments FOR EACH ROW EXECUTE FUNCTION private.audit_financial_mutation_v43();
CREATE TRIGGER ledger_membership_subscriptions_v43 AFTER INSERT OR DELETE OR UPDATE ON public.membership_subscriptions FOR EACH ROW EXECUTE FUNCTION private.audit_financial_mutation_v43();
CREATE TRIGGER ledger_offline_people_v43 AFTER INSERT OR DELETE OR UPDATE ON public.offline_people FOR EACH ROW EXECUTE FUNCTION private.audit_financial_mutation_v43();
CREATE TRIGGER ledger_profiles_update_v43 AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.audit_financial_mutation_v43();
CREATE TRIGGER ledger_treasury_entries_update_v43 AFTER DELETE OR UPDATE ON public.treasury_entries FOR EACH ROW EXECUTE FUNCTION private.audit_financial_mutation_v43();
CREATE TRIGGER ledger_treasury_event_participants_v43 AFTER INSERT OR DELETE OR UPDATE ON public.treasury_event_participants FOR EACH ROW EXECUTE FUNCTION private.audit_financial_mutation_v43();
CREATE TRIGGER ledger_treasury_opening_v43 AFTER INSERT OR UPDATE ON public.treasury_opening FOR EACH ROW EXECUTE FUNCTION private.audit_financial_mutation_v43();
CREATE TRIGGER ledger_treasury_transfers_update_v43 AFTER DELETE OR UPDATE ON public.treasury_transfers FOR EACH ROW EXECUTE FUNCTION private.audit_financial_mutation_v43();
