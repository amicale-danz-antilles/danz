-- Retrait de l'assistant privé DANZ. Aucune table métier ni donnée d'adhérent
-- ou de trésorerie n'est modifiée par cette migration.
-- La fonction Edge a été neutralisée avant ce retrait. Suppression complète
-- du déploiement et du secret OPENAI_API_KEY : tableau de bord Supabase.
drop function if exists public.danz_assistant_access();
drop table if exists public.danz_assistant_actions;
drop table if exists public.danz_assistant_technical_requests;
drop table if exists public.danz_assistant_usage;
drop table if exists private.danz_assistant_owner;
-- L'apparence et le sous-titre sont rétablis dans les fichiers du site.
drop table if exists public.site_preferences;
