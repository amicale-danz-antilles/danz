-- Correctif de sécurité pour les privilèges par défaut des nouvelles tables.
revoke all on public.offline_people from anon, authenticated;
grant select on public.offline_people to authenticated;
grant update(display_name,email,notes,is_amicaliste,membership_valid_until,updated_at) on public.offline_people to authenticated;
