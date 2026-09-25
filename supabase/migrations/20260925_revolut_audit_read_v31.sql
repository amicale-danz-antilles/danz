-- Le journal d’audit financier est visible uniquement au trésorier désigné.
-- Aucun historique n'est effacé; chaque correction et annulation est exportable.
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon;
grant select on public.admin_audit_log to authenticated;
drop policy if exists "treasurer may read financial audit" on public.admin_audit_log;
create policy "treasurer may read financial audit" on public.admin_audit_log
  for select to authenticated using ((select private.is_treasurer()));