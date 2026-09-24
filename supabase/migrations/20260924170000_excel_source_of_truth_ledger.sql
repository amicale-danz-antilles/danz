-- Reprise Excel 2026-2027 : source vérifiable, ventilation banque / espèces et historique individuel.
-- Migration non destructive : aucune donnée financière existante n'est remplacée.

create table if not exists public.treasury_import_batches (
 id uuid primary key default gen_random_uuid(),
 sha256 text not null unique check (sha256 ~ '^[a-f0-9]{64}$'),
 source_filename text not null,
 exercise text not null,
 opening_cents bigint not null,
 income_cents bigint not null,
 expense_cents bigint not null,
 confirmed_closing_cents bigint not null,
 membership_count integer not null,
 source_note text,
 imported_by uuid references public.profiles(id),
 imported_at timestamptz not null default now(),
 constraint treasury_import_reconciles check (opening_cents+income_cents-expense_cents=confirmed_closing_cents)
);
alter table public.treasury_import_batches enable row level security;
revoke all on public.treasury_import_batches from anon, authenticated;
grant select on public.treasury_import_batches to authenticated;
drop policy if exists "treasurer reads imports" on public.treasury_import_batches;
create policy "treasurer reads imports" on public.treasury_import_batches for select to authenticated using ((select private.is_treasurer()));

create table if not exists public.treasury_import_archive_lines (
 batch_id uuid not null references public.treasury_import_batches(id) on delete restrict,
 source_row integer not null,
 income_label text,
 income_cents integer,
 expense_label text,
 expense_cents integer,
 primary key(batch_id,source_row)
);
alter table public.treasury_import_archive_lines enable row level security;
revoke all on public.treasury_import_archive_lines from anon, authenticated;
grant select on public.treasury_import_archive_lines to authenticated;
drop policy if exists "treasurer reads import archive" on public.treasury_import_archive_lines;
create policy "treasurer reads import archive" on public.treasury_import_archive_lines for select to authenticated using ((select private.is_treasurer()));

alter table public.treasury_entries drop constraint if exists treasury_entries_payment_method_check;
alter table public.treasury_entries add constraint treasury_entries_payment_method_check
 check (payment_method = any(array['bank_transfer','card','cash','personal_advance','unassigned']));
alter table public.household_payments drop constraint if exists household_payments_method_check;
alter table public.household_payments add constraint household_payments_method_check
 check (method = any(array['bank_transfer','cash','unassigned']));
alter table public.treasury_opening add column if not exists unassigned_cents bigint not null default 0;
alter table public.treasury_opening add column if not exists import_batch_id uuid references public.treasury_import_batches(id);
alter table public.treasury_entries add column if not exists beneficiary_user_id uuid references public.profiles(id);
alter table public.treasury_entries add column if not exists beneficiary_offline_id uuid references public.offline_people(id);
alter table public.treasury_entries add column if not exists import_batch_id uuid references public.treasury_import_batches(id);
alter table public.treasury_entries add column if not exists source_row integer;
alter table public.treasury_entries add column if not exists source_date date;
alter table public.treasury_entries add column if not exists needs_review boolean not null default false;
alter table public.treasury_entries add constraint treasury_entry_single_beneficiary
 check (num_nonnulls(beneficiary_user_id,beneficiary_offline_id)<=1);
create unique index if not exists treasury_entry_import_source_unique on public.treasury_entries(import_batch_id,source_row)
 where import_batch_id is not null and source_row is not null;
create index if not exists treasury_entries_beneficiary_user_idx on public.treasury_entries(beneficiary_user_id);
create index if not exists treasury_entries_beneficiary_offline_idx on public.treasury_entries(beneficiary_offline_id);

alter table public.membership_subscriptions alter column user_id drop not null;
alter table public.membership_subscriptions add column if not exists offline_person_id uuid references public.offline_people(id);
alter table public.membership_subscriptions add column if not exists import_batch_id uuid references public.treasury_import_batches(id);
alter table public.membership_subscriptions add column if not exists source_row integer;
alter table public.membership_subscriptions add constraint membership_subscription_one_identity
 check (num_nonnulls(user_id,offline_person_id)=1);
create unique index if not exists membership_import_source_unique on public.membership_subscriptions(import_batch_id,source_row)
 where import_batch_id is not null and source_row is not null;

-- Le lien manuel entre une fiche sans compte et un profil transfère également ses cotisations archivées.
create or replace function private.treasury_sync_linked_membership()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if old.linked_user_id is null and new.linked_user_id is not null then
   update public.membership_subscriptions set user_id=new.linked_user_id,offline_person_id=null
     where offline_person_id=new.id;
   update public.treasury_entries set beneficiary_user_id=new.linked_user_id,beneficiary_offline_id=null
     where beneficiary_offline_id=new.id;
 end if;
 return new;
end $$;
revoke all on function private.treasury_sync_linked_membership() from public,anon,authenticated;
drop trigger if exists treasury_sync_membership_on_link on public.offline_people;
create trigger treasury_sync_membership_on_link after update of linked_user_id on public.offline_people
 for each row execute function private.treasury_sync_linked_membership();

-- Le total importé reste exact quand la trésorerie répartit progressivement le report initial.
create or replace function public.treasury_split_import_opening(p_bank_cents bigint,p_cash_cents bigint)
returns void language plpgsql security definer set search_path=''
as $$
declare v_opening public.treasury_opening%rowtype;v_amount bigint;
begin
 if auth.uid() is null or not private.is_treasurer() then raise exception 'Accès trésorier requis.'; end if;
 select * into v_opening from public.treasury_opening where id=1 for update;
 if not found or v_opening.import_batch_id is null then raise exception 'Aucun report Excel à répartir.'; end if;
 select opening_cents into v_amount from public.treasury_import_batches where id=v_opening.import_batch_id;
 if p_bank_cents<0 or p_cash_cents<0 or p_bank_cents+p_cash_cents>v_amount then
   raise exception 'Banque et caisse ne peuvent dépasser le report Excel de % centimes.',v_amount;
 end if;
 update public.treasury_opening
    set bank_cents=p_bank_cents,cash_cents=p_cash_cents,
        unassigned_cents=v_amount-p_bank_cents-p_cash_cents,
        updated_by=auth.uid(),updated_at=now()
    where id=1;
 insert into public.admin_audit_log(actor_id,action,details)
 values(auth.uid(),'treasury_opening_split',jsonb_build_object(
   'bank_cents',p_bank_cents,'cash_cents',p_cash_cents,'unassigned_cents',v_amount-p_bank_cents-p_cash_cents));
end $$;
revoke all on function public.treasury_split_import_opening(bigint,bigint) from public,anon;
grant execute on function public.treasury_split_import_opening(bigint,bigint) to authenticated;

-- Corriger une ligne dans son journal tout en préservant l'historique des modifications.
create or replace function public.treasury_update_entry(
 p_id uuid, p_label text,p_note text,p_category text,p_method text,
 p_user_id uuid,p_offline_id uuid,p_amount_cents integer,p_occurred_on date,p_event_id uuid
) returns void language plpgsql security definer set search_path=''
as $$
declare v_old public.treasury_entries%rowtype;
        v_new_method text;
        v_household_payment_method text;
begin
 if auth.uid() is null or not private.is_treasurer() then raise exception 'Accès trésorier requis.'; end if;
 select * into v_old from public.treasury_entries where id=p_id for update;
 if not found then raise exception 'Écriture introuvable.'; end if;
 if v_old.status='cancelled' or v_old.kind not in ('income','expense') then
   raise exception 'Cette écriture doit être corrigée depuis son module dédié.';
 end if;
 if nullif(btrim(p_label),'') is null or char_length(p_label)>250
   or p_amount_cents<=0 or p_amount_cents>100000000 or p_occurred_on is null
   or p_occurred_on>current_date or num_nonnulls(p_user_id,p_offline_id)>1 then
   raise exception 'Libellé, montant, date ou personne invalide.';
 end if;
 if p_method not in ('cash','bank_transfer','card','unassigned','personal_advance') then
   raise exception 'Compte ou mode de paiement invalide.';
 end if;
 if p_user_id is not null and not exists(select 1 from public.profiles where id=p_user_id and active)
   then raise exception 'Sélectionnez un compte actif.'; end if;
 if p_offline_id is not null and not exists(select 1 from public.offline_people where id=p_offline_id and linked_user_id is null)
   then raise exception 'Sélectionnez une fiche sans compte non encore liée.'; end if;
 if p_event_id is not null and not exists(select 1 from public.events where id=p_event_id)
   then raise exception 'Événement introuvable.'; end if;
 if v_old.payment_method='personal_advance' then
    if p_method<>'personal_advance' or v_old.status<>'pending' then
       raise exception 'Utilisez le remboursement des avances pour cette écriture.';
    end if;
    if p_user_id is null and p_offline_id is null then
       raise exception 'Identifiez la personne ayant avancé les fonds.';
    end if;
    update public.treasury_entries set
      label=btrim(p_label),note=nullif(btrim(p_note),''),category=p_category,
      advanced_by=p_user_id,advanced_by_offline=p_offline_id,
      amount_cents=p_amount_cents,occurred_at=p_occurred_on::timestamp at time zone 'UTC',
      event_id=p_event_id where id=p_id;
 elsif v_old.household_payment_id is not null then
    if p_method='personal_advance' or v_old.amount_cents<>p_amount_cents
      or v_old.category is distinct from p_category
      or v_old.beneficiary_user_id is distinct from p_user_id
      or v_old.beneficiary_offline_id is distinct from p_offline_id
      or v_old.event_id is distinct from p_event_id then
      raise exception 'Une cotisation encaissée ne peut changer de montant ou de bénéficiaire via le journal.';
    end if;
    v_household_payment_method:=case when p_method='cash' then 'cash'
      when p_method='unassigned' then 'unassigned' else 'bank_transfer' end;
    update public.household_payments set method=v_household_payment_method
      where id=v_old.household_payment_id;
    update public.treasury_entries set
      label=btrim(p_label),note=nullif(btrim(p_note),''),payment_method=p_method,
      occurred_at=p_occurred_on::timestamp at time zone 'UTC'
      where id=p_id;
 else
    if p_method='personal_advance' then
       raise exception 'Créez une avance personnelle depuis la saisie de dépenses.';
    end if;
    update public.treasury_entries set
       label=btrim(p_label),note=nullif(btrim(p_note),''),category=p_category,
       payment_method=p_method,beneficiary_user_id=p_user_id,beneficiary_offline_id=p_offline_id,
       amount_cents=p_amount_cents,occurred_at=p_occurred_on::timestamp at time zone 'UTC',
       event_id=p_event_id where id=p_id;
 end if;
 insert into public.admin_audit_log(actor_id,action,details)
 values(auth.uid(),'treasury_entry_edited',
   jsonb_build_object('entry_id',p_id,'old',to_jsonb(v_old)-
     'receipt_storage_path'-'receipt_file_name','new',(
     select to_jsonb(e)-'receipt_storage_path'-'receipt_file_name'
     from public.treasury_entries e where e.id=p_id)));
end $$;
revoke all on function public.treasury_update_entry(uuid,text,text,text,text,uuid,uuid,integer,date,uuid) from public,anon;
grant execute on function public.treasury_update_entry(uuid,text,text,text,text,uuid,uuid,integer,date,uuid) to authenticated;
