-- Centre de publications unifié : brouillons, programmation, notifications et albums.

alter table public.news
  add column if not exists notify_on_publish boolean not null default true;

alter table public.events
  add column if not exists published boolean not null default true,
  add column if not exists notify_on_publish boolean not null default true;

alter table public.event_albums
  add column if not exists published boolean not null default true,
  add column if not exists audience text not null default 'everyone',
  add column if not exists publish_at timestamp with time zone not null default now(),
  add column if not exists notified_at timestamp with time zone,
  add column if not exists notify_on_publish boolean not null default true;

-- Les albums existants conservent l'audience de leur événement.
update public.event_albums a
set audience = e.audience
from public.events e
where e.id = a.event_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_albums_audience_check'
      and conrelid = 'public.event_albums'::regclass
  ) then
    alter table public.event_albums
      add constraint event_albums_audience_check
      check (audience in ('everyone','military','amicaliste','admin'));
  end if;
end $$;

create index if not exists event_albums_publish_queue_idx
  on public.event_albums (published, publish_at, notified_at);
create index if not exists events_publish_queue_idx
  on public.events (published, publish_at, notified_at);
create index if not exists news_publish_queue_idx
  on public.news (published, publish_at, notified_at);

-- Réglages globaux administrateur. Les préférences individuelles restent prioritaires.
create table if not exists public.notification_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  news boolean not null default true,
  events boolean not null default true,
  gallery boolean not null default true,
  membership_requests boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamp with time zone not null default now()
);

insert into public.notification_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.notification_settings enable row level security;

drop policy if exists "admins manage notification settings" on public.notification_settings;
create policy "admins manage notification settings"
on public.notification_settings
for all
to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists "admins read notification preferences" on public.notification_preferences;
create policy "admins read notification preferences"
on public.notification_preferences
for select
to authenticated
using (private.is_admin());

drop policy if exists "admins read push subscriptions" on public.push_subscriptions;
create policy "admins read push subscriptions"
on public.push_subscriptions
for select
to authenticated
using (private.is_admin());

create or replace function public.set_notification_settings_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notification_settings_updated_at on public.notification_settings;
create trigger notification_settings_updated_at
before update on public.notification_settings
for each row execute function public.set_notification_settings_updated_at();

-- Les membres ne voient que les événements publiés et arrivés à échéance.
drop policy if exists "members read events" on public.events;
create policy "members read events"
on public.events
for select
to authenticated
using (
  private.is_admin()
  or (
    private.is_active_member()
    and published = true
    and publish_at <= now()
    and private.can_view_audience(audience)
  )
);

-- Même cycle de publication pour les albums ; l'événement parent doit lui aussi être visible.
drop policy if exists "members read visible event albums" on public.event_albums;
create policy "members read visible event albums"
on public.event_albums
for select
to authenticated
using (
  private.is_admin()
  or (
    private.is_active_member()
    and event_albums.published = true
    and event_albums.publish_at <= now()
    and private.can_view_audience(event_albums.audience)
    and exists (
      select 1
      from public.events e
      where e.id = event_albums.event_id
        and e.published = true
        and e.publish_at <= now()
        and private.can_view_audience(e.audience)
    )
  )
);

-- File d'envoi centralisée. Une publication désactivée globalement ou individuellement
-- est marquée comme traitée afin d'éviter une rafale de notifications anciennes plus tard.
create or replace function private.dispatch_due_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_enabled boolean := true;
  v_news boolean := true;
  v_events boolean := true;
  v_gallery boolean := true;
begin
  select s.enabled, s.news, s.events, s.gallery
    into v_enabled, v_news, v_events, v_gallery
  from public.notification_settings s
  where s.id = 1;

  if not found then
    v_enabled := true;
    v_news := true;
    v_events := true;
    v_gallery := true;
  end if;

  for r in
    select id, title, audience, notify_on_publish
    from public.news
    where published = true and publish_at <= now() and notified_at is null
  loop
    if v_enabled and v_news and coalesce(r.notify_on_publish, true) then
      perform private.send_push_event('news:' || r.audience, 'Nouvelle actualité', r.title, '/danz/#/');
    end if;
    update public.news set notified_at = now() where id = r.id and notified_at is null;
  end loop;

  for r in
    select id, title, audience, notify_on_publish
    from public.events
    where published = true and publish_at <= now() and notified_at is null
  loop
    if v_enabled and v_events and coalesce(r.notify_on_publish, true) then
      perform private.send_push_event('events:' || r.audience, 'Nouvel événement', r.title, '/danz/#/agenda');
    end if;
    update public.events set notified_at = now() where id = r.id and notified_at is null;
  end loop;

  for r in
    select a.id, a.audience, a.notify_on_publish, e.title
    from public.event_albums a
    join public.events e on e.id = a.event_id
    where a.published = true
      and a.publish_at <= now()
      and a.notified_at is null
      and e.published = true
      and e.publish_at <= now()
  loop
    if v_enabled and v_gallery and coalesce(r.notify_on_publish, true) then
      perform private.send_push_event('gallery:' || r.audience, 'Nouvel album', r.title, '/danz/#/galerie');
    end if;
    update public.event_albums set notified_at = now() where id = r.id and notified_at is null;
  end loop;

  -- Ancienne galerie conservée pour les contenus historiques encore présents.
  for r in
    select min(id) as id,
           coalesce(event_id::text,'legacy') as folder_key,
           coalesce(max(title),'Nouveaux médias') as title,
           audience
    from public.gallery
    where publish_at <= now() and notified_at is null
    group by coalesce(event_id::text,'legacy'), audience
  loop
    if v_enabled and v_gallery then
      perform private.send_push_event('gallery:' || r.audience, 'Nouveaux souvenirs', r.title, '/danz/#/galerie');
    end if;
    update public.gallery
       set notified_at = now()
     where publish_at <= now()
       and notified_at is null
       and coalesce(event_id::text,'legacy') = r.folder_key
       and audience = r.audience;
  end loop;

  -- Les documents ne déclenchent plus de notification membre mais restent marqués comme traités.
  for r in
    select id
    from public.documents
    where publish_at <= now() and notified_at is null
  loop
    update public.documents set notified_at = now() where id = r.id and notified_at is null;
  end loop;
end;
$$;

create or replace function private.notify_membership_request_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requester text;
  v_enabled boolean := true;
  v_membership boolean := true;
begin
  select s.enabled, s.membership_requests
    into v_enabled, v_membership
  from public.notification_settings s
  where s.id = 1;

  requester := coalesce(nullif(trim(concat_ws(' ', new.first_name, new.last_name)), ''), new.full_name, 'Un nouvel utilisateur');

  if coalesce(v_enabled, true) and coalesce(v_membership, true) then
    perform private.send_push_event(
      'membership_request',
      'Nouvelle demande d’accès',
      requester || ' a envoyé une demande d’inscription.',
      '/danz/#/administration/demandes'
    );
  end if;
  return new;
end;
$$;
