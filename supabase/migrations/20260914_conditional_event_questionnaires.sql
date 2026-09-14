alter table public.polls add column if not exists poll_type text not null default 'simple';
alter table public.polls add column if not exists published boolean not null default true;

do $$ begin
  alter table public.polls add constraint polls_poll_type_check check (poll_type in ('simple','questionnaire'));
exception when duplicate_object then null; end $$;

create table if not exists public.poll_questions (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  prompt text not null,
  question_type text not null default 'yes_no' check (question_type in ('yes_no','quantity','single_choice','text')),
  sort_order integer not null default 1,
  required boolean not null default true,
  attendance_gate boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, poll_id),
  check (not attendance_gate or question_type = 'yes_no')
);

create unique index if not exists poll_questions_one_attendance_gate on public.poll_questions(poll_id) where attendance_gate = true;
create index if not exists poll_questions_poll_order_idx on public.poll_questions(poll_id, sort_order);

create table if not exists public.poll_question_answers (
  poll_id uuid not null references public.polls(id) on delete cascade,
  question_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  answer_boolean boolean,
  answer_number integer,
  answer_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (question_id, user_id),
  foreign key (question_id, poll_id) references public.poll_questions(id, poll_id) on delete cascade,
  check (num_nonnulls(answer_boolean, answer_number, answer_text) = 1)
);
create index if not exists poll_question_answers_poll_idx on public.poll_question_answers(poll_id);
create index if not exists poll_question_answers_user_idx on public.poll_question_answers(user_id, poll_id);

alter table public.poll_questions enable row level security;
alter table public.poll_question_answers enable row level security;

drop policy if exists "members read polls" on public.polls;
create policy "members read polls" on public.polls for select to authenticated using (private.is_active_member() and published = true);

drop policy if exists "members read poll options" on public.poll_options;
create policy "members read poll options" on public.poll_options for select to authenticated using (private.is_active_member() and exists (select 1 from public.polls p where p.id = poll_options.poll_id and p.published = true));

drop policy if exists "members insert own poll votes" on public.poll_votes;
create policy "members insert own poll votes" on public.poll_votes for insert to authenticated with check (user_id = auth.uid() and private.is_active_member() and exists (select 1 from public.polls p where p.id = poll_votes.poll_id and p.published = true and p.poll_type = 'simple' and p.active = true and (p.closes_at is null or p.closes_at > now())));
drop policy if exists "members update own poll votes" on public.poll_votes;
create policy "members update own poll votes" on public.poll_votes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and private.is_active_member() and exists (select 1 from public.polls p where p.id = poll_votes.poll_id and p.published = true and p.poll_type = 'simple' and p.active = true and (p.closes_at is null or p.closes_at > now())));
drop policy if exists "members delete own poll votes" on public.poll_votes;
create policy "members delete own poll votes" on public.poll_votes for delete to authenticated using (user_id = auth.uid() and private.is_active_member() and exists (select 1 from public.polls p where p.id = poll_votes.poll_id and p.published = true and p.poll_type = 'simple' and p.active = true and (p.closes_at is null or p.closes_at > now())));

create policy "admins manage poll questions" on public.poll_questions for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "members read published poll questions" on public.poll_questions for select to authenticated using (private.is_active_member() and exists (select 1 from public.polls p where p.id = poll_questions.poll_id and p.published = true));
create policy "admins read questionnaire answers" on public.poll_question_answers for select to authenticated using (private.is_admin());
create policy "members read own questionnaire answers" on public.poll_question_answers for select to authenticated using (user_id = auth.uid() and private.is_active_member());

create or replace function public.submit_poll_questionnaire(p_poll_id uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_poll public.polls%rowtype;
  v_attendance_id uuid;
  v_attendance_answer jsonb;
  v_present boolean;
  q record;
  a jsonb;
  v_text text;
  v_number integer;
  v_min integer;
  v_max integer;
begin
  if v_user is null or not private.is_active_member() then raise exception 'Accès non autorisé.'; end if;
  select * into v_poll from public.polls where id = p_poll_id;
  if not found or v_poll.poll_type <> 'questionnaire' or v_poll.published <> true or v_poll.active <> true or (v_poll.closes_at is not null and v_poll.closes_at <= now()) then raise exception 'Ce recensement n’est pas disponible.'; end if;
  select id into v_attendance_id from public.poll_questions where poll_id = p_poll_id and attendance_gate = true limit 1;
  if v_attendance_id is null then raise exception 'Question de présence manquante.'; end if;
  select value into v_attendance_answer from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) where value->>'question_id' = v_attendance_id::text limit 1;
  if v_attendance_answer is null or jsonb_typeof(v_attendance_answer->'answer_boolean') <> 'boolean' then raise exception 'Indiquez si vous serez présent.'; end if;
  v_present := (v_attendance_answer->>'answer_boolean')::boolean;

  if v_present then
    for q in select * from public.poll_questions where poll_id = p_poll_id order by sort_order, created_at loop
      a := null;
      select value into a from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) where value->>'question_id' = q.id::text limit 1;
      if a is null then if q.required then raise exception 'Réponse obligatoire manquante : %', q.prompt; end if; continue; end if;
      if q.question_type = 'yes_no' then
        if jsonb_typeof(a->'answer_boolean') <> 'boolean' then raise exception 'Réponse invalide : %', q.prompt; end if;
      elsif q.question_type = 'quantity' then
        if coalesce(a->>'answer_number','') !~ '^-?[0-9]+$' then raise exception 'Quantité invalide : %', q.prompt; end if;
        v_number := (a->>'answer_number')::integer; v_min := coalesce((q.settings->>'min')::integer, 0); v_max := coalesce((q.settings->>'max')::integer, 20);
        if v_number < v_min or v_number > v_max then raise exception 'Quantité hors limites : %', q.prompt; end if;
      elsif q.question_type = 'single_choice' then
        v_text := nullif(trim(a->>'answer_text'), '');
        if v_text is null or not ((q.settings->'options') ? v_text) then raise exception 'Choix invalide : %', q.prompt; end if;
      elsif q.question_type = 'text' then
        v_text := nullif(trim(a->>'answer_text'), '');
        if q.required and v_text is null then raise exception 'Réponse obligatoire manquante : %', q.prompt; end if;
        if length(coalesce(v_text,'')) > 2000 then raise exception 'Réponse trop longue : %', q.prompt; end if;
      end if;
    end loop;
  end if;

  delete from public.poll_question_answers where poll_id = p_poll_id and user_id = v_user;
  if not v_present then insert into public.poll_question_answers(poll_id, question_id, user_id, answer_boolean) values (p_poll_id, v_attendance_id, v_user, false); return; end if;

  for q in select * from public.poll_questions where poll_id = p_poll_id order by sort_order, created_at loop
    a := null;
    select value into a from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) where value->>'question_id' = q.id::text limit 1;
    if a is null then continue; end if;
    if q.question_type = 'yes_no' then insert into public.poll_question_answers(poll_id, question_id, user_id, answer_boolean) values (p_poll_id, q.id, v_user, (a->>'answer_boolean')::boolean);
    elsif q.question_type = 'quantity' then insert into public.poll_question_answers(poll_id, question_id, user_id, answer_number) values (p_poll_id, q.id, v_user, (a->>'answer_number')::integer);
    else v_text := nullif(trim(a->>'answer_text'), ''); if v_text is not null then insert into public.poll_question_answers(poll_id, question_id, user_id, answer_text) values (p_poll_id, q.id, v_user, v_text); end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.submit_poll_questionnaire(uuid,jsonb) from public;
grant execute on function public.submit_poll_questionnaire(uuid,jsonb) to authenticated;

create or replace function private.dispatch_due_notifications()
returns void language plpgsql security definer set search_path to 'public' as $$
declare r record; v_enabled boolean := true; v_news boolean := true; v_events boolean := true; v_gallery boolean := true; v_polls boolean := true;
begin
  select s.enabled,s.news,s.events,s.gallery,s.polls into v_enabled,v_news,v_events,v_gallery,v_polls from public.notification_settings s where s.id=1;
  if not found then v_enabled:=true;v_news:=true;v_events:=true;v_gallery:=true;v_polls:=true; end if;
  for r in select id,title,audience,notify_on_publish from public.news where published=true and publish_at<=now() and notified_at is null loop if v_enabled and v_news and coalesce(r.notify_on_publish,true) then perform private.send_push_event('news:'||r.audience,'Nouvelle publication',r.title,'/danz/#/'); end if; update public.news set notified_at=now() where id=r.id and notified_at is null; end loop;
  for r in select id,title,audience,notify_on_publish from public.events where published=true and publish_at<=now() and notified_at is null loop if v_enabled and v_events and coalesce(r.notify_on_publish,true) then perform private.send_push_event('events:'||r.audience,'Nouvelle publication',r.title,'/danz/#/agenda'); end if; update public.events set notified_at=now() where id=r.id and notified_at is null; end loop;
  for r in select a.id,a.audience,a.notify_on_publish,e.title from public.event_albums a join public.events e on e.id=a.event_id where a.published=true and a.publish_at<=now() and a.notified_at is null and e.published=true and e.publish_at<=now() loop if v_enabled and v_gallery and coalesce(r.notify_on_publish,true) then perform private.send_push_event('gallery:'||r.audience,'Nouvel album',r.title,'/danz/#/galerie'); end if; update public.event_albums set notified_at=now() where id=r.id and notified_at is null; end loop;
  for r in select min(id) as id,coalesce(event_id::text,'legacy') as folder_key,coalesce(max(title),'Nouveaux médias') as title,audience from public.gallery where publish_at<=now() and notified_at is null group by coalesce(event_id::text,'legacy'),audience loop if v_enabled and v_gallery then perform private.send_push_event('gallery:'||r.audience,'Nouveaux souvenirs',r.title,'/danz/#/galerie'); end if; update public.gallery set notified_at=now() where publish_at<=now() and notified_at is null and coalesce(event_id::text,'legacy')=r.folder_key and audience=r.audience; end loop;
  for r in select id,title,notify_on_publish from public.polls where published=true and active=true and notified_at is null loop if v_enabled and v_polls and coalesce(r.notify_on_publish,true) then perform private.send_push_event('documents','Nouveau sondage',r.title,'/danz/#/'); end if; update public.polls set notified_at=now() where id=r.id and notified_at is null; end loop;
  for r in select id from public.documents where publish_at<=now() and notified_at is null loop update public.documents set notified_at=now() where id=r.id and notified_at is null; end loop;
end;
$$;
