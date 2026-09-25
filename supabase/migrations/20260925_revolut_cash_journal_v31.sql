-- v31 : annulable, restorable and auditable finance journal.
-- "bank" is the existing ledger identifier for Revolut; never rename historical account keys.
-- No import entries, paid contributions, opening balances or receipts are modified here.

alter table public.treasury_entries
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancel_reason text,
  add column if not exists cancelled_previous_status text;
alter table public.treasury_transfers
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancel_reason text,
  add column if not exists updated_at timestamptz;

create or replace function public.treasury_cancel_entry(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_previous public.treasury_entries%rowtype;
begin
  if auth.uid() is null or not private.is_treasurer() then
    raise exception 'Accès réservé au trésorier.';
  end if;
  if nullif(btrim(p_reason),'') is null or char_length(btrim(p_reason)) not between 5 and 500 then
    raise exception 'Précisez le motif d’annulation (au moins cinq caractères).';
  end if;
  select * into v_previous from public.treasury_entries where id=p_id for update;
  if not found then raise exception 'Écriture introuvable.'; end if;
  if v_previous.status='cancelled' then raise exception 'Cette écriture est déjà annulée.'; end if;
  if v_previous.kind not in ('income','expense') or v_previous.household_payment_id is not null then
    raise exception 'Un paiement de cotisation ou de foyer doit être corrigé depuis la gestion dédiée.';
  end if;
  if v_previous.status not in ('settled','pending') then
    raise exception 'Cette écriture ne peut pas être annulée depuis le journal.';
  end if;
  update public.treasury_entries
    set status='cancelled',cancelled_previous_status=v_previous.status,
        cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=btrim(p_reason)
    where id=p_id;
  insert into public.admin_audit_log(actor_id,action,details)
    values(auth.uid(),'treasury_entry_cancelled',
      jsonb_build_object('entry_id',p_id,'source_batch_id',v_previous.import_batch_id,
        'source_row',v_previous.source_row,'reason',btrim(p_reason),
        'old_status',v_previous.status,'amount_cents',v_previous.amount_cents,
        'payment_method',v_previous.payment_method));
end;
$$;
revoke all on function public.treasury_cancel_entry(uuid,text) from public,anon;
grant execute on function public.treasury_cancel_entry(uuid,text) to authenticated;

create or replace function public.treasury_restore_entry(p_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_entry public.treasury_entries%rowtype;
begin
  if auth.uid() is null or not private.is_treasurer() then
    raise exception 'Accès réservé au trésorier.';
  end if;
  select * into v_entry from public.treasury_entries where id=p_id for update;
  if not found or v_entry.status <> 'cancelled' then
    raise exception 'Aucune écriture annulée à restaurer.';
  end if;
  if v_entry.household_payment_id is not null or
     v_entry.cancelled_previous_status not in ('settled','pending') then
    raise exception 'Cette écriture doit être restaurée depuis le module dédié.';
  end if;
  update public.treasury_entries set
    status=v_entry.cancelled_previous_status,cancelled_previous_status=null,
    cancelled_at=null,cancelled_by=null,cancel_reason=null
    where id=p_id;
  insert into public.admin_audit_log(actor_id,action,details)
    values(auth.uid(),'treasury_entry_restored',
      jsonb_build_object('entry_id',p_id,'source_batch_id',v_entry.import_batch_id,
        'source_row',v_entry.source_row,'cancel_reason',v_entry.cancel_reason,
        'restored_status',v_entry.cancelled_previous_status,
        'amount_cents',v_entry.amount_cents));
end;
$$;
revoke all on function public.treasury_restore_entry(uuid) from public,anon;
grant execute on function public.treasury_restore_entry(uuid) to authenticated;

-- Changes and cancellation of a transfer affect both account balances, never income/expenses.
create or replace function public.treasury_manage_transfer(
  p_id uuid,p_action text,p_from_account text default null,p_to_account text default null,
  p_amount_cents integer default null,p_occurred_on date default null,
  p_note text default null,p_reason text default null
) returns void language plpgsql security definer set search_path=''
as $$
declare v_old public.treasury_transfers%rowtype;
begin
  if auth.uid() is null or not private.is_treasurer() then
    raise exception 'Accès réservé au trésorier.';
  end if;
  select * into v_old from public.treasury_transfers where id=p_id for update;
  if not found then raise exception 'Transfert introuvable.'; end if;
  if p_action='update' then
    if v_old.cancelled_at is not null then raise exception 'Restaurez le transfert avant de le modifier.'; end if;
    if p_from_account not in ('bank','cash') or p_to_account not in ('bank','cash')
      or p_from_account=p_to_account or p_amount_cents not between 1 and 100000000
      or p_occurred_on is null or p_occurred_on>current_date
      or char_length(coalesce(p_note,''))>1000 then
      raise exception 'Montant, comptes, date ou motif invalide.';
    end if;
    update public.treasury_transfers
      set from_account=p_from_account,to_account=p_to_account,
          amount_cents=p_amount_cents,
          occurred_at=p_occurred_on::timestamp at time zone 'UTC',
          note=nullif(btrim(p_note),''),updated_at=now()
      where id=p_id;
  elsif p_action='cancel' then
    if v_old.cancelled_at is not null then raise exception 'Transfert déjà annulé.'; end if;
    if nullif(btrim(p_reason),'') is null or char_length(btrim(p_reason)) not between 5 and 500 then
      raise exception 'Précisez le motif d’annulation (au moins cinq caractères).';
    end if;
    update public.treasury_transfers
      set cancelled_at=now(),cancelled_by=auth.uid(),
          cancel_reason=btrim(p_reason),updated_at=now()
      where id=p_id;
  elsif p_action='restore' then
    if v_old.cancelled_at is null then raise exception 'Ce transfert est déjà actif.'; end if;
    update public.treasury_transfers
      set cancelled_at=null,cancelled_by=null,cancel_reason=null,updated_at=now()
      where id=p_id;
  else
    raise exception 'Action de transfert inconnue.';
  end if;
  insert into public.admin_audit_log(actor_id,action,details)
    values(auth.uid(),'treasury_transfer_'||p_action,
      jsonb_build_object('transfer_id',p_id,'old',to_jsonb(v_old),'new',
        (select to_jsonb(t) from public.treasury_transfers t where t.id=p_id)));
end;
$$;
revoke all on function public.treasury_manage_transfer(uuid,text,text,text,integer,date,text,text) from public,anon;
grant execute on function public.treasury_manage_transfer(uuid,text,text,text,integer,date,text,text) to authenticated;

-- Direct journal inserts have the same traceability as RPC edits/cancellations.
create or replace function private.audit_new_finance_row()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_table_name='treasury_entries' then
    insert into public.admin_audit_log(actor_id,action,details)
      values(new.created_by,'treasury_entry_created',
        jsonb_build_object('entry_id',new.id,'kind',new.kind,'amount_cents',new.amount_cents,
          'payment_method',new.payment_method,'label',new.label,'event_id',new.event_id));
  else
    insert into public.admin_audit_log(actor_id,action,details)
      values(new.created_by,'treasury_transfer_created',
        jsonb_build_object('transfer_id',new.id,'amount_cents',new.amount_cents,
          'from_account',new.from_account,'to_account',new.to_account));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_new_finance_row() from public,anon,authenticated;
drop trigger if exists treasury_entry_insert_audit on public.treasury_entries;
create trigger treasury_entry_insert_audit after insert on public.treasury_entries
  for each row execute function private.audit_new_finance_row();
drop trigger if exists treasury_transfer_insert_audit on public.treasury_transfers;
create trigger treasury_transfer_insert_audit after insert on public.treasury_transfers
  for each row execute function private.audit_new_finance_row();
