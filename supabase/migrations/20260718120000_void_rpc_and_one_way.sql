-- Audit 2026-07-18 #2: voids were forgeable and reversible.
--
-- The append-only trigger deliberately left the four void columns
-- (voided / void_reason / voided_by / voided_at) unguarded, and volunteers
-- can UPDATE their own rows — so via a raw REST call a volunteer could void
-- their own cash donation, stamp voided_by with the admin's id and a
-- backdated voided_at, then later un-void the row. That defeats the whole
-- audit-trail promise.
--
-- Two changes close it:
--   1. All voiding goes through void_row() (SECURITY DEFINER), which stamps
--      voided_by/voided_at server-side from the session — the client can no
--      longer choose them.
--   2. forbid_financial_edit() now guards the void columns too: they may only
--      change from inside a function that sets the `app.voiding` flag, the
--      transition is one-way (false -> true), and a voided row is frozen.
--
-- The flag is a transaction-local GUC. void_row()/clear_donation_history()
-- set it right before their UPDATE; a direct PostgREST call cannot (it never
-- issues a SET), so current_setting('app.voiding', true) is null for it.

-- ── Append-only + void integrity ────────────────────────────────────────
-- Republished in full because three triggers reference it by name. The
-- per-table financial-field guards are verbatim from the multi-tenancy
-- migration; the new part is the shared void-integrity block at the top.
create or replace function forbid_financial_edit() returns trigger
language plpgsql as $$
begin
  -- Void columns changing at all?
  if new.voided     is distinct from old.voided
     or new.void_reason is distinct from old.void_reason
     or new.voided_by   is distinct from old.voided_by
     or new.voided_at   is distinct from old.voided_at then
    -- Only void_row()/clear_donation_history() may touch them.
    if current_setting('app.voiding', true) is distinct from 'on' then
      raise exception 'void metadata is set only by void_row()';
    end if;
    -- Once voided, a row is frozen — no un-void, no re-stamp.
    if old.voided then
      raise exception 'a voided row cannot be changed';
    end if;
    -- The only permitted transition is into the voided state.
    if not new.voided then
      raise exception 'void is one-way';
    end if;
  end if;

  if TG_TABLE_NAME = 'donations' then
    if new.donor_name <> old.donor_name
       or new.donor_phone is distinct from old.donor_phone
       or new.amount_paise <> old.amount_paise
       or new.mode <> old.mode
       or new.collected_by <> old.collected_by
       or new.receipt_no <> old.receipt_no
       or new.public_token <> old.public_token
       or new.created_at <> old.created_at
       or new.mandal_id <> old.mandal_id
       or new.client_idempotency_key is distinct from old.client_idempotency_key then
      raise exception 'donations rows are append-only; void and re-enter instead of editing';
    end if;
  elsif TG_TABLE_NAME = 'expenses' then
    if new.category <> old.category
       or new.amount_paise <> old.amount_paise
       or new.description is distinct from old.description
       or new.paid_by <> old.paid_by
       or new.paid_from <> old.paid_from
       or new.created_at <> old.created_at
       or new.mandal_id <> old.mandal_id then
      raise exception 'expenses rows are append-only; void and re-enter instead of editing';
    end if;
  elsif TG_TABLE_NAME = 'handovers' then
    if new.volunteer_id <> old.volunteer_id
       or new.amount_paise <> old.amount_paise
       or new.received_by <> old.received_by
       or new.note is distinct from old.note
       or new.created_at <> old.created_at
       or new.mandal_id <> old.mandal_id then
      raise exception 'handovers rows are append-only; void and re-enter instead of editing';
    end if;
  end if;
  return new;
end;
$$;

-- ── The one void path ───────────────────────────────────────────────────
-- SECURITY DEFINER so the UPDATE bypasses RLS; authorization is done
-- explicitly in the WHERE clause instead, mirroring the existing per-role
-- update policies exactly: an admin voids any row in their mandal, a
-- volunteer only their own. voided_by/voided_at are stamped from the session
-- (app_user_id() / now()), never taken from the client. `not voided` in the
-- WHERE makes a second void of the same row a no-op that raises below.
create or replace function void_row(target_table text, row_id uuid, reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := app_user_id();
  m     uuid := app_mandal_id();
begin
  if actor is null or m is null then
    raise exception 'not a member of any mandal';
  end if;

  -- Transaction-local — lets this function's UPDATE past forbid_financial_edit,
  -- and only this function's (a raw client UPDATE can't set it).
  perform set_config('app.voiding', 'on', true);

  if target_table = 'donations' then
    update donations set voided = true, void_reason = reason,
      voided_by = actor, voided_at = now()
    where id = row_id and mandal_id = m and not voided
      and (is_admin() or collected_by = actor);
  elsif target_table = 'expenses' then
    update expenses set voided = true, void_reason = reason,
      voided_by = actor, voided_at = now()
    where id = row_id and mandal_id = m and not voided
      and (is_admin() or paid_by = actor);
  elsif target_table = 'handovers' then
    update handovers set voided = true, void_reason = reason,
      voided_by = actor, voided_at = now()
    where id = row_id and mandal_id = m and not voided
      and (is_admin() or volunteer_id = actor);
  else
    raise exception 'not a voidable table: %', target_table;
  end if;

  if not found then
    raise exception 'row not found, not yours to void, or already voided';
  end if;
end;
$$;

revoke execute on function void_row(text, uuid, text) from public;
grant execute on function void_row(text, uuid, text) to authenticated;

-- ── clear_donation_history: bulk void, same new gate ────────────────────
-- Its UPDATE now also trips the void guard, so it must raise the flag too.
-- Otherwise identical to the profile/history migration's version.
create or replace function clear_donation_history(reason text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  me      uuid := app_user_id();
  cleared integer;
begin
  if not is_admin() then
    raise exception 'only an admin can clear the donation history';
  end if;

  perform set_config('app.voiding', 'on', true);

  update donations
     set voided      = true,
         void_reason = coalesce(nullif(btrim(reason), ''), 'Cleared by admin'),
         voided_by   = me,
         voided_at   = now()
   where mandal_id = app_mandal_id()
     and not voided;

  get diagnostics cleared = row_count;
  return cleared;
end;
$$;

revoke execute on function clear_donation_history(text) from public;
grant execute on function clear_donation_history(text) to authenticated;
