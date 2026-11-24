-- Lecture seule de la référence, le journal reste fermé.
create policy v2_reference_treasurer_read on danz_finance_v2_staging.reprise for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role='admin' and p.is_treasurer));
grant usage on schema danz_finance_v2_staging to authenticated;
grant select on danz_finance_v2_staging.reprise to authenticated;
create view public.danz_v2_reference with (security_invoker=true, security_barrier=true) as select as_of,state,reference from danz_finance_v2_staging.reprise where id=1;
revoke all on public.danz_v2_reference from public,anon,authenticated,service_role;
grant select on public.danz_v2_reference to authenticated;
notify pgrst,'reload schema';