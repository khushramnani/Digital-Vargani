-- Task 10: offline queue support. `client_idempotency_key` is generated
-- client-side (the Dexie outbox row's `localId`, a crypto.randomUUID()) and
-- sent unchanged on insert — it's the dedup mechanism the offline sync path
-- relies on when a sync completes server-side but the client crashes before
-- recording that locally: a retried insert with the same key trips this
-- UNIQUE constraint (Postgres/PostgREST error code 23505), and the client
-- treats that as "already synced" rather than a failure (see
-- src/lib/queue/sync.ts's syncOutboxItem). Deliberately NOT added to
-- enforce_insert_defaults() — unlike receipt_no/public_token (always
-- server-generated, always overwritten), this column is always
-- client-generated and must be preserved exactly as sent.

alter table donations add column client_idempotency_key text unique;

-- Re-publish forbid_financial_edit() with one new guard clause added to the
-- donations branch (client_idempotency_key must never be edited after
-- insert, same append-only rule as every other financial field on this
-- table). Rest of the function body is unchanged, copied verbatim from
-- 20260714111950_schema_and_rls.sql — the existing triggers reference this
-- function by name, so they pick up the new body automatically.
create or replace function forbid_financial_edit() returns trigger
language plpgsql as $$
begin
  if TG_TABLE_NAME = 'donations' then
    if new.donor_name <> old.donor_name
       or new.donor_phone is distinct from old.donor_phone
       or new.amount_paise <> old.amount_paise
       or new.mode <> old.mode
       or new.collected_by <> old.collected_by
       or new.receipt_no <> old.receipt_no
       or new.public_token <> old.public_token
       or new.created_at <> old.created_at
       or new.client_idempotency_key is distinct from old.client_idempotency_key then
      raise exception 'donations rows are append-only; void and re-enter instead of editing';
    end if;
  elsif TG_TABLE_NAME = 'expenses' then
    if new.category <> old.category
       or new.amount_paise <> old.amount_paise
       or new.description is distinct from old.description
       or new.paid_by <> old.paid_by
       or new.paid_from <> old.paid_from
       or new.created_at <> old.created_at then
      raise exception 'expenses rows are append-only; void and re-enter instead of editing';
    end if;
  elsif TG_TABLE_NAME = 'handovers' then
    if new.volunteer_id <> old.volunteer_id
       or new.amount_paise <> old.amount_paise
       or new.received_by <> old.received_by
       or new.note is distinct from old.note
       or new.created_at <> old.created_at then
      raise exception 'handovers rows are append-only; void and re-enter instead of editing';
    end if;
  end if;
  return new;
end;
$$;
