revoke execute on function public.submit_poll_questionnaire(uuid,jsonb) from anon;
revoke execute on function public.submit_poll_questionnaire(uuid,jsonb) from public;
grant execute on function public.submit_poll_questionnaire(uuid,jsonb) to authenticated;
