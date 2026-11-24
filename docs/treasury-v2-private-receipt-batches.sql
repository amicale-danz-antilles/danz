-- Migration additive, zone privée. Aucun droit client et aucune activation.
create table danz_finance_v2_staging.batch_control (
 id integer primary key check(id=1),
 enabled boolean not null default false,
 exercise_id uuid references danz_finance_v2_staging.exercises(id)
);
insert into danz_finance_v2_staging.batch_control(id) values(1);
create table danz_finance_v2_staging.receivable_items (
 id text primary key check(length(btrim(id)) between 1 and 200),
 label text not null check(length(btrim(label)) between 1 and 200),
 original_cents bigint not null check(original_cents between 1 and 9007199254740991),
 remaining_cents bigint not null check(remaining_cents between 0 and original_cents)
);
create table danz_finance_v2_staging.receipt_batches (
 id uuid primary key,
 booked_on date not null,
 actor uuid not null,
 request_rows jsonb not null,
 total_cents bigint not null check(total_cents>0),
 created_at timestamptz not null default clock_timestamp()
);
create table danz_finance_v2_staging.receipt_allocations (
 batch_id uuid not null references danz_finance_v2_staging.receipt_batches(id),
 item_id text not null references danz_finance_v2_staging.receivable_items(id),
 journal_id uuid not null unique references danz_finance_v2_staging.journal(id),
 account text not null check(account in ('512','530')),
 cents bigint not null check(cents>0),
 primary key(batch_id,item_id)
);
alter table danz_finance_v2_staging.batch_control enable row level security;
alter table danz_finance_v2_staging.receivable_items enable row level security;
alter table danz_finance_v2_staging.receipt_batches enable row level security;
alter table danz_finance_v2_staging.receipt_allocations enable row level security;
revoke all on danz_finance_v2_staging.batch_control,danz_finance_v2_staging.receivable_items,danz_finance_v2_staging.receipt_batches,danz_finance_v2_staging.receipt_allocations from public,anon,authenticated,service_role;
create function danz_finance_v2_staging.post_receipt_batch(p_id uuid,p_date date,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); cfg danz_finance_v2_staging.batch_control%rowtype; existing danz_finance_v2_staging.receipt_batches%rowtype; item danz_finance_v2_staging.receivable_items%rowtype; r jsonb; ids text[]:='{}'; n bigint; total bigint:=0; a text; jid uuid; count_rows integer;
begin
 if actor is null or not exists(select 1 from public.profiles where id=actor and active and role='admin' and is_treasurer) then raise exception 'Accès trésorier requis'; end if;
 select * into cfg from danz_finance_v2_staging.batch_control where id=1 for update;
 if not found or not cfg.enabled or cfg.exercise_id is null then raise exception 'Bascule non activée'; end if;
 if p_id is null or p_date is null or p_date>(clock_timestamp() at time zone 'America/Martinique')::date or jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Lot invalide'; end if;
 count_rows:=jsonb_array_length(p_rows);
 if count_rows<1 or count_rows>100 then raise exception 'Nombre de lignes invalide'; end if;
 select * into existing from danz_finance_v2_staging.receipt_batches where id=p_id;
 if found then
  if existing.actor<>actor or existing.booked_on<>p_date or existing.request_rows<>p_rows then raise exception 'Identifiant de lot déjà utilisé'; end if;
  return jsonb_build_object('id',p_id,'total_cents',existing.total_cents,'replayed',true);
 end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r)<>'object' or coalesce(r->>'itemId','')='' or r->>'itemId'=any(ids) or coalesce(r->>'account','') not in ('512','530') or coalesce(jsonb_typeof(r->'cents'),'')<>'number' or coalesce(r->>'cents','') !~ '^[1-9][0-9]{0,14}$' then raise exception 'Ligne invalide ou doublon'; end if;
  ids:=array_append(ids,r->>'itemId'); n:=(r->>'cents')::bigint;
  select * into item from danz_finance_v2_staging.receivable_items where id=r->>'itemId' for update;
  if not found or n>item.remaining_cents then raise exception 'Créance inconnue ou montant excessif'; end if;
  total:=total+n;
 end loop;
 if total>9007199254740991 then raise exception 'Total hors limite'; end if;
 insert into danz_finance_v2_staging.receipt_batches(id,booked_on,actor,request_rows,total_cents) values(p_id,p_date,actor,p_rows,total);
 for r in select value from jsonb_array_elements(p_rows) loop
  n:=(r->>'cents')::bigint; a:=r->>'account';
  select * into item from danz_finance_v2_staging.receivable_items where id=r->>'itemId' for update;
  insert into danz_finance_v2_staging.journal(exercise_id,source,booked_on,label,lines,created_by)
   values(cfg.exercise_id,'receipt:'||p_id::text||':'||md5(item.id),p_date,'Encaissement '||item.label,jsonb_build_array(jsonb_build_object('account',a,'side','D','cents',n),jsonb_build_object('account','4672','side','C','cents',n)),actor)
   returning id into jid;
  update danz_finance_v2_staging.receivable_items set remaining_cents=remaining_cents-n where id=item.id;
  insert into danz_finance_v2_staging.receipt_allocations(batch_id,item_id,journal_id,account,cents) values(p_id,item.id,jid,a,n);
 end loop;
 return jsonb_build_object('id',p_id,'total_cents',total,'replayed',false);
end $$;
revoke all on function danz_finance_v2_staging.post_receipt_batch(uuid,date,jsonb) from public,anon,authenticated,service_role;
