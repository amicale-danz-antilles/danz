-- Migration de préparation isolée, sans données réelles. Ne pas rejouer si déjà appliquée.



create schema danz_finance_v2_staging;
revoke all on schema danz_finance_v2_staging from public, anon, authenticated, service_role;
create table danz_finance_v2_staging.exercises(
 id uuid primary key default gen_random_uuid(),
 starts_on date not null,
 ends_on date not null,
 closed_at timestamptz,
 check(starts_on<=ends_on),
 exclude using gist (daterange(starts_on,ends_on,'[]') with &&)
);
create function danz_finance_v2_staging.valid_lines(p jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare l jsonb; d numeric:=0; c numeric:=0; n numeric;
begin
 if p is null or jsonb_typeof(p)<>'array' then return false; end if;
 if jsonb_array_length(p)<2 or jsonb_array_length(p)>500 then return false; end if;
 for l in select value from jsonb_array_elements(p) loop
  if jsonb_typeof(l)<>'object' or coalesce(l->>'account','') not in ('512','530','4671','4672','4673','401','756','706','707','754','606','616','625','627','110','471')
    or coalesce(l->>'side','') not in ('D','C') or coalesce(jsonb_typeof(l->'cents'),'')<>'number'
    or coalesce(l->>'cents','') !~ '^[1-9][0-9]{0,15}$' then return false; end if;
  n:=(l->>'cents')::numeric;
  if n>9007199254740991 then return false; end if;
  if l->>'side'='D' then d:=d+n; else c:=c+n; end if;
 end loop;
 return d=c and d>0 and d<=9007199254740991;
end $$;
create table danz_finance_v2_staging.journal(
 id uuid primary key default gen_random_uuid(),
 exercise_id uuid not null references danz_finance_v2_staging.exercises(id),
 source text not null unique check(length(btrim(source)) between 1 and 200),
 booked_on date not null,
 label text not null check(length(btrim(label)) between 1 and 300),
 lines jsonb not null check(danz_finance_v2_staging.valid_lines(lines)),
 reverses uuid unique references danz_finance_v2_staging.journal(id),
 created_at timestamptz not null default clock_timestamp(),
 created_by uuid not null,
 check(reverses is null or reverses<>id)
);
create index danz_finance_v2_staging_journal_date on danz_finance_v2_staging.journal(exercise_id,booked_on);
create function danz_finance_v2_staging.guard_journal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare ex danz_finance_v2_staging.exercises%rowtype; original danz_finance_v2_staging.journal%rowtype; expected jsonb; actual jsonb;
begin
 if tg_op<>'INSERT' then raise exception 'Journal immuable : utiliser une contrepassation'; end if;
 select * into ex from danz_finance_v2_staging.exercises where id=new.exercise_id for update;
 if not found or ex.closed_at is not null or new.booked_on<ex.starts_on or new.booked_on>ex.ends_on then raise exception 'Exercice absent, fermé ou date hors exercice'; end if;
 if new.booked_on>(clock_timestamp() at time zone 'America/Martinique')::date then raise exception 'Date future interdite'; end if;
 if new.reverses is not null then
  select * into original from danz_finance_v2_staging.journal where id=new.reverses;
  if not found or new.booked_on<original.booked_on then raise exception 'Contrepassation sans original valide'; end if;
  select jsonb_agg(x order by x) into expected from (select jsonb_build_array(l->>'account',case when l->>'side'='D' then 'C' else 'D' end,(l->>'cents')::numeric) x from jsonb_array_elements(original.lines) l) t;
  select jsonb_agg(x order by x) into actual from (select jsonb_build_array(l->>'account',l->>'side',(l->>'cents')::numeric) x from jsonb_array_elements(new.lines) l) t;
  if actual is distinct from expected then raise exception 'Contrepassation différente de l original'; end if;
 end if;
 return new;
end $$;
create trigger danz_v2_guard before insert or update or delete on danz_finance_v2_staging.journal for each row execute function danz_finance_v2_staging.guard_journal();
create function danz_finance_v2_staging.guard_exercise()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Exercice non supprimable'; end if;
 if old.closed_at is not null or new.id<>old.id or new.starts_on<>old.starts_on or new.ends_on<>old.ends_on or new.closed_at is null then raise exception 'Seule la clôture d un exercice ouvert est autorisée'; end if;
 new.closed_at:=clock_timestamp();
 return new;
end $$;
create trigger danz_v2_exercise_guard before update or delete on danz_finance_v2_staging.exercises for each row execute function danz_finance_v2_staging.guard_exercise();
alter table danz_finance_v2_staging.exercises enable row level security;
alter table danz_finance_v2_staging.journal enable row level security;
revoke all on all tables in schema danz_finance_v2_staging from public, anon, authenticated, service_role;
revoke all on all functions in schema danz_finance_v2_staging from public, anon, authenticated, service_role;



create table danz_finance_v2_staging.reprise(
 id integer primary key check(id=1),
 as_of date not null,
 reference jsonb not null,
 state text not null default 'pending_review' check(state='pending_review'),
 created_at timestamptz not null default clock_timestamp()
);
alter table danz_finance_v2_staging.reprise enable row level security;
revoke all on danz_finance_v2_staging.reprise from public, anon, authenticated, service_role;
