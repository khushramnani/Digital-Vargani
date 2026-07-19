#!/usr/bin/env bash
# supabase/verify-local.sh
#
# Structural verification of the schema_and_rls migration + seed.sql against
# a throwaway local PostgreSQL cluster. There is no live Supabase project to
# `supabase db push` against yet, and this machine has no Docker (so
# `supabase start` is not an option) — this script is the substitute:
#   1. initdb a scratch data dir under the OS temp dir (never inside the repo)
#   2. start postgres on a free-ish local port
#   3. stub just enough of Supabase's `auth` schema for the migration + RLS
#      to be meaningfully testable
#   4. apply the migration and seed.sql
#   5. assert the append-only triggers actually block financial-field edits
#   6. assert RLS actually restricts volunteer/admin/anon access as intended
#   7. tear the cluster down and delete the scratch dir
#
# Every assertion below raises/fails loudly (non-zero exit) on violation —
# this is not a "did it run" smoke test, it's "did the trigger/policy do
# the thing it claims to do".
#
# Usage: bash supabase/verify-local.sh   (run from anywhere; paths are
# resolved relative to this script's location)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_FILE="$SCRIPT_DIR/seed.sql"

PORT="${VERIFY_LOCAL_PORT:-55432}"
DB_NAME="vm_verify"
PGUSER="postgres"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vm-verify-pg.XXXXXX")"
LOG_FILE="$DATA_DIR/postgres.log"

# Fall back to a scoop install under the current user's home if the pg
# binaries aren't already on PATH (derived from $HOME, not a hardcoded
# username, so this works for any developer with the same scoop layout).
PG_BIN_FALLBACK="${HOME:-/c/Users/$USER}/scoop/apps/postgresql/current/bin"
if ! command -v pg_ctl >/dev/null 2>&1 && [ -d "$PG_BIN_FALLBACK" ]; then
  export PATH="$PG_BIN_FALLBACK:$PATH"
fi

PSQL=(psql -h localhost -p "$PORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -X -q)

cleanup() {
  local exit_code=$?
  set +e
  if [ -f "$DATA_DIR/postmaster.pid" ]; then
    pg_ctl -D "$DATA_DIR" -m fast stop >/dev/null 2>&1
  fi
  rm -rf "$DATA_DIR"
  if [ $exit_code -eq 0 ]; then
    echo "PASS: all migration/trigger/RLS assertions held."
  else
    echo "FAIL: verify-local.sh aborted (exit $exit_code). See output above."
  fi
  exit $exit_code
}
trap cleanup EXIT

echo "== initdb ($DATA_DIR) =="
initdb -D "$DATA_DIR" -U "$PGUSER" --auth=trust --no-locale -E UTF8 >/dev/null

echo "== starting postgres on port $PORT =="
pg_ctl -D "$DATA_DIR" -l "$LOG_FILE" -o "-p $PORT -c listen_addresses=localhost" -w start

echo "== createdb $DB_NAME =="
createdb -h localhost -p "$PORT" -U "$PGUSER" "$DB_NAME"

echo "== stubbing auth schema =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Supabase installs pgcrypto into a dedicated `extensions` schema, which is
-- why the migrations qualify their calls as extensions.gen_random_bytes().
-- A bare `create extension pgcrypto` on a stock cluster lands in public, so
-- without this the very first migration fails on "schema extensions does not
-- exist" — mirror Supabase's layout instead.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Supabase exposes the decoded JWT payload as auth.jwt(); create_mandal()
-- reads its is_anonymous claim to reject volunteer (signInAnonymously)
-- sessions. This stub returns whatever request.jwt.claims is set to, which
-- is enough to exercise that guard from both sides.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create role anon;
create role authenticated;
SQL

echo "== stubbing storage schema (Task 6) =="
# storage.buckets/storage.objects are part of Supabase's Storage extension
# schema, which this scratch cluster doesn't have. Rebuilding Storage's
# real internals (ownership, metadata, folder-path helpers, etc.) would be
# disproportionate for what this migration actually needs verified: that
# its RLS policies gate insert/update to is_admin() and leave select open.
# This stub is exactly that minimal shape — just enough columns for the
# migration's own policies (which only reference bucket_id) to be
# meaningfully exercised, not a Storage reimplementation.
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
create schema if not exists storage;
create table if not exists storage.buckets (
  id     text primary key,
  name   text not null,
  public boolean not null default false
);
create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

-- The multi-tenancy migration scopes the mandal-assets policies by folder
-- prefix, which needs Supabase's path helper.
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select string_to_array(name, '/')
$$;
SQL

echo "== applying migrations (in filename order) =="
for migration in "$SCRIPT_DIR"/migrations/*.sql; do
  echo "   -> $(basename "$migration")"
  "${PSQL[@]}" -d "$DB_NAME" -f "$migration"
done

echo "== applying seed.sql =="
"${PSQL[@]}" -d "$DB_NAME" -f "$SEED_FILE"

echo "== granting Supabase's platform-level default table privileges =="
# Real Supabase projects grant broad table privileges to anon/authenticated
# via ALTER DEFAULT PRIVILEGES at the platform level (outside user
# migrations) and rely on RLS, not the grant, to restrict rows. Without this
# stub, every authenticated/anon query below would fail on a missing GRANT
# before ever reaching a policy, which would make the RLS assertions
# meaningless (they'd "pass" for the wrong reason).
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
grant usage on schema public to anon, authenticated;

-- Supabase grants this at the platform level too. enforce_insert_defaults()
-- is not SECURITY DEFINER, so it runs as the caller and needs USAGE on
-- extensions to reach gen_random_bytes() when generating public_token.
grant usage on schema extensions to anon, authenticated;
grant select, insert, update on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

grant usage on schema storage to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
grant select, insert, update on storage.objects to anon, authenticated;
SQL

echo "== assertion: link_admin_account() links exactly the matching admin row =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Fresh admin row created specifically for this test; auth_user_id is still
-- null (the seed admin, id ...001, is also still null at this point — its
-- own backfill happens further below, unrelated to this test). Volunteer
-- ...002 (straight from seed, email NULL) is the negative control proving
-- link_admin_account() never touches a volunteer row, even one sharing no
-- email with anyone (email is globally UNIQUE on this table, so a volunteer
-- literally cannot share an admin's email — the `role = 'admin'` guard in
-- the WHERE clause is what's actually relied on, not email uniqueness).
insert into users (id, mandal_id, name, role, email, active) values
  ('00000000-0000-0000-0000-000000000099', '11111111-1111-1111-1111-000000000001', 'Link Test Admin', 'admin', 'linktest-admin@example.com', true);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000099', 'linktest-admin@example.com');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000099';
select link_admin_account();
reset role;

DO $$
BEGIN
  ASSERT (SELECT auth_user_id FROM users WHERE id = '00000000-0000-0000-0000-000000000099')
    = 'aaaaaaaa-0000-0000-0000-000000000099',
    'FAIL: link_admin_account() did not link the matching admin row';

  ASSERT (SELECT auth_user_id FROM users WHERE id = '00000000-0000-0000-0000-000000000002') IS NULL,
    'FAIL: link_admin_account() linked a volunteer row with no email';

  ASSERT (SELECT auth_user_id FROM users WHERE id = '00000000-0000-0000-0000-000000000001') IS NULL,
    'FAIL: link_admin_account() linked an unrelated admin row with a different email';

  RAISE NOTICE 'PASS: link_admin_account() linked exactly the matching admin row, and only that row';
END $$;

-- Idempotency: re-running after already linked (e.g. a second app load)
-- must be a silent no-op, not an error and not a re-link to a different id.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000099';
select link_admin_account();
reset role;

DO $$
BEGIN
  ASSERT (SELECT auth_user_id FROM users WHERE id = '00000000-0000-0000-0000-000000000099')
    = 'aaaaaaaa-0000-0000-0000-000000000099',
    'FAIL: re-running link_admin_account() should be a harmless no-op';
  RAISE NOTICE 'PASS: link_admin_account() is idempotent on repeat calls';
END $$;
SQL

echo "== assertion: redeem_invite() links exactly the matching volunteer row and is single-use =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Fresh volunteer row + fresh anonymous auth identity, isolated from the
-- seed volunteers (002/003) and their later backfill/RLS assertions below.
insert into users (id, mandal_id, name, role, invite_token, active) values
  ('00000000-0000-0000-0000-000000000098', '11111111-1111-1111-1111-000000000001', 'Redeem Test Volunteer', 'volunteer', 'redeem-test-token', true);

insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-000000000098');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000098';
set request.jwt.claims = '{"is_anonymous": true}'; -- redeem now requires an anonymous session (audit #5)
select redeem_invite('redeem-test-token');
reset role;

DO $$
BEGIN
  ASSERT (SELECT auth_user_id FROM users WHERE id = '00000000-0000-0000-0000-000000000098')
    = 'aaaaaaaa-0000-0000-0000-000000000098',
    'FAIL: redeem_invite() did not link the matching volunteer row';

  ASSERT (SELECT invite_token FROM users WHERE id = '00000000-0000-0000-0000-000000000098') IS NULL,
    'FAIL: redeem_invite() did not clear invite_token after redemption';

  RAISE NOTICE 'PASS: redeem_invite() linked the matching volunteer row and cleared invite_token';
END $$;

-- Single-use: the token is now null on that row. Simulate a second person
-- (a brand-new anonymous identity) opening the same already-shared link —
-- this must fail loudly, not silently no-op and not re-link a second
-- identity to the same row.
insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-000000000097');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000097';
set request.jwt.claims = '{"is_anonymous": true}';
DO $$
BEGIN
  BEGIN
    PERFORM redeem_invite('redeem-test-token');
    RAISE EXCEPTION 'SECURITY HOLE: redeem_invite() succeeded a second time on an already-redeemed token';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invalid or already-used invite link%' THEN
      RAISE NOTICE 'PASS: redeem_invite() rejects replay of an already-used (now-null) token (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Hardening (audit #5): a real (non-anonymous) session must not redeem an
-- invite — the volunteer flow is always signInAnonymously().
insert into users (id, mandal_id, name, role, invite_token, active) values
  ('00000000-0000-0000-0000-000000000095', '11111111-1111-1111-1111-000000000001', 'Non-anon Redeem Test', 'volunteer', 'nonanon-token', true);
insert into auth.users (id) values ('aaaaaaaa-0000-0000-0000-000000000095');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000095';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
BEGIN
  BEGIN
    PERFORM redeem_invite('nonanon-token');
    RAISE EXCEPTION 'SECURITY HOLE: a non-anonymous session redeemed an invite';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%volunteer session%' THEN
      RAISE NOTICE 'PASS: redeem_invite() rejects a non-anonymous session (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

DO $$
BEGIN
  ASSERT (SELECT auth_user_id FROM users WHERE id = '00000000-0000-0000-0000-000000000098')
    = 'aaaaaaaa-0000-0000-0000-000000000098',
    'FAIL: rejected replay must not have changed the already-linked auth_user_id';
END $$;
SQL

echo "== backfilling auth_user_id + seeding test donations =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- enforce_insert_defaults() stamps mandal_id from app_mandal_id(), which
-- needs a session to resolve. Superuser still bypasses RLS, so this block
-- tests exactly what it tested before: trigger behaviour, not policies.
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin

insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002');

update users set auth_user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-000000000001'; -- Admin Treasurer
update users set auth_user_id = 'aaaaaaaa-0000-0000-0000-000000000002'
  where id = '00000000-0000-0000-0000-000000000002'; -- Volunteer One

-- Superuser is the table owner and bypasses RLS; this is just test-data
-- setup, not itself an RLS assertion. mandal_id is explicit here because
-- there's no session for enforce_insert_defaults() to stamp it from.
insert into donations (mandal_id, donor_name, amount_paise, mode, collected_by) values
  ('11111111-1111-1111-1111-000000000001', 'Vol1 Donor', 10000, 'cash', '00000000-0000-0000-0000-000000000002'),
  ('11111111-1111-1111-1111-000000000001', 'Vol2 Donor', 20000, 'cash', '00000000-0000-0000-0000-000000000003');
SQL

echo "== assertion: append-only trigger blocks financial-field edits =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
DO $$
BEGIN
  BEGIN
    UPDATE donations SET amount_paise = amount_paise + 1 WHERE donor_name = 'Vol1 Donor';
    RAISE EXCEPTION 'TRIGGER TEST FAILED: amount_paise update succeeded but should have been blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%append-only%' THEN
      RAISE NOTICE 'PASS: trigger blocked donations.amount_paise edit (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- A direct client UPDATE of the void columns is now rejected — voiding must
-- go through void_row() (audit 2026-07-18 #2). The trigger fires even for the
-- table owner, so this holds here too. (void_row()'s own happy path, the
-- server-side stamp, and one-wayness are exercised in their own block below.)
DO $$
BEGIN
  BEGIN
    UPDATE donations SET voided = true, void_reason = 'forged direct void'
      WHERE donor_name = 'Vol2 Donor';
    RAISE EXCEPTION 'SECURITY HOLE: a direct void UPDATE succeeded (must require void_row())';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%void_row%' OR SQLERRM LIKE '%void metadata%' THEN
      RAISE NOTICE 'PASS: direct void UPDATE blocked — voiding must go through void_row() (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
SQL

echo "== assertion: Task 8 sms_sent_at is updatable and does not loosen the append-only guard =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Updating only sms_sent_at on an own row must succeed (it's not in
-- forbid_financial_edit()'s guarded column list, and the existing
-- donations_volunteer_update/donations_admin_update RLS policies already
-- permit this).
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- Volunteer One
UPDATE donations SET sms_sent_at = now() WHERE donor_name = 'Vol1 Donor';
reset role;
DO $$
BEGIN
  ASSERT (SELECT sms_sent_at FROM donations WHERE donor_name = 'Vol1 Donor') IS NOT NULL,
    'FAIL: sms_sent_at update on an own row should have succeeded';
  RAISE NOTICE 'PASS: sms_sent_at update on an own row succeeded';
END $$;

-- Regression: a protected field on the very same row must still be blocked
-- — proves the new column didn't accidentally loosen the append-only guard.
DO $$
BEGIN
  BEGIN
    UPDATE donations SET amount_paise = amount_paise + 1 WHERE donor_name = 'Vol1 Donor';
    RAISE EXCEPTION 'TRIGGER TEST FAILED: amount_paise update succeeded but should have been blocked (sms_sent_at regression)';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%append-only%' THEN
      RAISE NOTICE 'PASS: adding sms_sent_at did not loosen the append-only guard on amount_paise (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
SQL

echo "== assertion: receipt_no unique constraint + insert-time forgery override =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- enforce_insert_defaults() stamps mandal_id from app_mandal_id(), which
-- needs a session to resolve. Superuser still bypasses RLS, so this block
-- tests exactly what it tested before: trigger behaviour, not policies.
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin

DO $$
DECLARE
  dup_receipt_no bigint;
BEGIN
  SELECT receipt_no INTO dup_receipt_no FROM donations WHERE donor_name = 'Vol1 Donor';

  -- The insert-time trigger overrides whatever receipt_no the client sends
  -- with a fresh nextval(), so this insert must succeed (no unique violation
  -- bubbles up) AND must not actually reuse the duplicate value supplied.
  -- Attributed to the admin (not a volunteer) so it doesn't skew the
  -- per-volunteer row-count assertions later in this script.
  INSERT INTO donations (donor_name, amount_paise, mode, collected_by, receipt_no)
    VALUES ('Forged Receipt No', 100, 'cash', '00000000-0000-0000-0000-000000000001', dup_receipt_no);

  -- Scoped to the mandal: receipt_no is only unique WITHIN one now, so a
  -- global count would be inflated by any other mandal's identical number.
  ASSERT (SELECT count(*) FROM donations
           WHERE receipt_no = dup_receipt_no
             AND mandal_id = '11111111-1111-1111-1111-000000000001') = 1,
    'FAIL: two donations in the same mandal ended up sharing a receipt_no';
  ASSERT (SELECT receipt_no FROM donations WHERE donor_name = 'Forged Receipt No') <> dup_receipt_no,
    'FAIL: forged duplicate receipt_no was not overridden by the insert trigger';

  RAISE NOTICE 'PASS: receipt_no never collides — insert trigger overrides client-supplied duplicates before uniqueness even matters';
END $$;

-- Belt-and-suspenders: the UNIQUE constraint itself must still exist and
-- reject a raw duplicate if something ever bypassed the trigger.
DO $$
DECLARE
  dup_receipt_no bigint;
BEGIN
  SELECT receipt_no INTO dup_receipt_no FROM donations WHERE donor_name = 'Vol1 Donor';
  BEGIN
    -- Disable the insert trigger just for this probe so the raw constraint
    -- is what's being exercised, not the trigger papering over it. That also
    -- means nothing stamps mandal_id, so it's supplied explicitly — and it
    -- must match 'Vol1 Donor''s mandal, since the constraint is now
    -- unique(mandal_id, receipt_no): a duplicate receipt_no in a DIFFERENT
    -- mandal is legal and would prove nothing here.
    ALTER TABLE donations DISABLE TRIGGER donations_enforce_insert;
    INSERT INTO donations (mandal_id, donor_name, amount_paise, mode, collected_by, receipt_no)
      VALUES ('11111111-1111-1111-1111-000000000001', 'Should Violate Unique', 100, 'cash',
              '00000000-0000-0000-0000-000000000001', dup_receipt_no);
    ALTER TABLE donations ENABLE TRIGGER donations_enforce_insert;
    RAISE EXCEPTION 'FAIL: duplicate receipt_no was accepted with the insert trigger disabled — UNIQUE constraint missing';
  EXCEPTION WHEN unique_violation THEN
    ALTER TABLE donations ENABLE TRIGGER donations_enforce_insert;
    RAISE NOTICE 'PASS: receipt_no UNIQUE constraint independently rejects duplicates (%)', SQLERRM;
  END;
END $$;
SQL

echo "== assertion: insert-time trigger overrides client-forged financial fields =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- enforce_insert_defaults() stamps mandal_id from app_mandal_id(), which
-- needs a session to resolve. Superuser still bypasses RLS, so this block
-- tests exactly what it tested before: trigger behaviour, not policies.
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin

DO $$
DECLARE
  forged_row donations%ROWTYPE;
BEGIN
  -- Attributed to the admin (not a volunteer) so it doesn't skew the
  -- per-volunteer row-count assertions later in this script.
  INSERT INTO donations (
    donor_name, amount_paise, mode, collected_by,
    receipt_no, public_token, voided, void_reason, voided_by, voided_at
  ) VALUES (
    'Forged Fields Donor', 100, 'cash', '00000000-0000-0000-0000-000000000001',
    999999, 'client-forged-token', true, 'client forged void', '00000000-0000-0000-0000-000000000002', now()
  ) RETURNING * INTO forged_row;

  ASSERT forged_row.receipt_no <> 999999,
    'FAIL: client-supplied receipt_no (999999) was not overridden';
  ASSERT forged_row.public_token <> 'client-forged-token',
    'FAIL: client-supplied public_token was not overridden';
  ASSERT forged_row.voided = false,
    'FAIL: client-supplied voided=true was not overridden to false';
  ASSERT forged_row.void_reason IS NULL,
    'FAIL: client-supplied void_reason was not cleared';
  ASSERT forged_row.voided_by IS NULL,
    'FAIL: client-supplied voided_by was not cleared';
  ASSERT forged_row.voided_at IS NULL,
    'FAIL: client-supplied voided_at was not cleared';

  RAISE NOTICE 'PASS: insert trigger overrode all forged fields (receipt_no=%, public_token=%, voided=%)',
    forged_row.receipt_no, forged_row.public_token, forged_row.voided;
END $$;
SQL

echo "== assertion: handovers.note is append-only (asymmetry fix) =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- enforce_insert_defaults() stamps mandal_id from app_mandal_id(), which
-- needs a session to resolve. Superuser still bypasses RLS, so this block
-- tests exactly what it tested before: trigger behaviour, not policies.
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin

DO $$
DECLARE
  h_id uuid;
BEGIN
  INSERT INTO handovers (volunteer_id, amount_paise, received_by, note)
    VALUES ('00000000-0000-0000-0000-000000000002', 500, '00000000-0000-0000-0000-000000000001', 'original note')
    RETURNING id INTO h_id;

  BEGIN
    UPDATE handovers SET note = 'edited note' WHERE id = h_id;
    RAISE EXCEPTION 'TRIGGER TEST FAILED: handovers.note update succeeded but should have been blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%append-only%' THEN
      RAISE NOTICE 'PASS: trigger blocked handovers.note edit (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
SQL

echo "== assertion: created_at is append-only on all three tables =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- enforce_insert_defaults() stamps mandal_id from app_mandal_id(), which
-- needs a session to resolve. Superuser still bypasses RLS, so this block
-- tests exactly what it tested before: trigger behaviour, not policies.
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin

DO $$
BEGIN
  BEGIN
    UPDATE donations SET created_at = now() - interval '1 day' WHERE donor_name = 'Vol1 Donor';
    RAISE EXCEPTION 'TRIGGER TEST FAILED: donations.created_at update succeeded but should have been blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%append-only%' THEN
      RAISE NOTICE 'PASS: trigger blocked donations.created_at edit (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;

DO $$
DECLARE
  e_id uuid;
BEGIN
  INSERT INTO expenses (category, amount_paise, paid_by, paid_from)
    VALUES ('Misc', 500, '00000000-0000-0000-0000-000000000001', 'cash')
    RETURNING id INTO e_id;
  BEGIN
    UPDATE expenses SET created_at = now() - interval '1 day' WHERE id = e_id;
    RAISE EXCEPTION 'TRIGGER TEST FAILED: expenses.created_at update succeeded but should have been blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%append-only%' THEN
      RAISE NOTICE 'PASS: trigger blocked expenses.created_at edit (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;

DO $$
DECLARE
  h_id uuid;
BEGIN
  INSERT INTO handovers (volunteer_id, amount_paise, received_by)
    VALUES ('00000000-0000-0000-0000-000000000002', 500, '00000000-0000-0000-0000-000000000001')
    RETURNING id INTO h_id;
  BEGIN
    UPDATE handovers SET created_at = now() - interval '1 day' WHERE id = h_id;
    RAISE EXCEPTION 'TRIGGER TEST FAILED: handovers.created_at update succeeded but should have been blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%append-only%' THEN
      RAISE NOTICE 'PASS: trigger blocked handovers.created_at edit (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
SQL

echo "== assertion: volunteer RLS (select + insert) =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- Volunteer One

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM donations;
  ASSERT v_count = 1, format('FAIL: volunteer should see exactly 1 donation, saw %s', v_count);

  SELECT count(*) INTO v_count FROM donations WHERE donor_name = 'Vol2 Donor';
  ASSERT v_count = 0, 'FAIL: volunteer should not see the other volunteer''s donation';
END $$;

-- Volunteer inserting their OWN donation must succeed.
insert into donations (donor_name, amount_paise, mode, collected_by)
  values ('Vol1 Self Insert', 100, 'cash', '00000000-0000-0000-0000-000000000002');

-- Volunteer inserting a donation attributed to someone else must be
-- rejected by the WITH CHECK clause, not silently allowed.
DO $$
BEGIN
  BEGIN
    insert into donations (donor_name, amount_paise, mode, collected_by)
      values ('Should Be Rejected', 100, 'cash', '00000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'SECURITY HOLE: volunteer inserted a donation for another volunteer without error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      RAISE NOTICE 'PASS: cross-volunteer insert rejected (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;

reset role;
SQL

echo "== assertion: admin RLS (sees every row) =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- Admin Treasurer

DO $$
DECLARE
  v_count int;
BEGIN
  -- 2 seed donations + 'Forged Receipt No' + 'Forged Fields Donor' (both
  -- admin-attributed, inserted by the Fix 1/2 assertions above) + 'Vol1
  -- Self Insert' (from the volunteer-insert assertion above) = 5.
  SELECT count(*) INTO v_count FROM donations;
  ASSERT v_count = 5, format('FAIL: admin should see all 5 donations, saw %s', v_count);
END $$;

reset role;
SQL

echo "== assertion: anon can read one receipt via token, cannot bulk-select donations =="
# Fetch the real token as the setup superuser (anon's own view of `donations`
# is RLS-filtered to nothing, so anon can't look this up itself — that's the
# point). Done in plain bash/psql scalar capture, not a DO block, so no
# fragile psql-variable-inside-dollar-quoting is involved.
VOL1_TOKEN=$("${PSQL[@]}" -d "$DB_NAME" -tAc "select public_token from donations where donor_name = 'Vol1 Donor';")
if [ -z "$VOL1_TOKEN" ]; then
  echo "FAIL: could not fetch Vol1 Donor's public_token for the anon test" >&2
  exit 1
fi

ANON_COUNT=$("${PSQL[@]}" -d "$DB_NAME" -tAc "set role anon; select count(*) from donations;")
if [ "$ANON_COUNT" != "0" ]; then
  echo "FAIL: anon should see 0 donations via bulk select, saw $ANON_COUNT" >&2
  exit 1
fi

ANON_DONOR=$("${PSQL[@]}" -d "$DB_NAME" -tAc "set role anon; select donor_name from get_public_receipt('$VOL1_TOKEN');")
if [ "$ANON_DONOR" != "Vol1 Donor" ]; then
  echo "FAIL: get_public_receipt('$VOL1_TOKEN') returned '$ANON_DONOR', expected 'Vol1 Donor'" >&2
  exit 1
fi
echo "PASS: anon sees 0 rows via bulk select, exactly 1 correct row via get_public_receipt()"

echo "== assertion: mandal-assets storage RLS — admin can insert/update =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- Admin Treasurer

-- Paths are <mandal_id>/<file> now: mandal_assets_admin_write checks
-- (storage.foldername(name))[1] against app_mandal_id(), so a flat path is
-- rejected outright.
insert into storage.objects (bucket_id, name) values ('mandal-assets', '11111111-1111-1111-1111-000000000001/logo-test.png');

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM storage.objects WHERE name = '11111111-1111-1111-1111-000000000001/logo-test.png') = 1,
    'FAIL: admin insert into their own mandal folder should have succeeded';
END $$;

update storage.objects set name = '11111111-1111-1111-1111-000000000001/logo-test-renamed.png'
  where name = '11111111-1111-1111-1111-000000000001/logo-test.png';

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM storage.objects WHERE name = '11111111-1111-1111-1111-000000000001/logo-test-renamed.png') = 1,
    'FAIL: admin update within their own mandal folder should have succeeded';
END $$;

-- The isolation this migration adds: mandal one's admin must not be able to
-- write into mandal two's folder, even though they are a legitimate admin.
DO $$
BEGIN
  BEGIN
    insert into storage.objects (bucket_id, name)
      values ('mandal-assets', '22222222-2222-2222-2222-000000000002/stolen-logo.png');
    RAISE EXCEPTION 'SECURITY HOLE: an admin wrote into another mandal''s asset folder';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: cross-mandal storage write rejected (%)', SQLERRM;
  END;
END $$;

reset role;
SQL

echo "== assertion: mandal-assets storage RLS — non-admin insert is rejected =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- Volunteer One (non-admin)

DO $$
BEGIN
  BEGIN
    insert into storage.objects (bucket_id, name) values ('mandal-assets', '11111111-1111-1111-1111-000000000001/should-be-rejected.png');
    RAISE EXCEPTION 'SECURITY HOLE: non-admin insert into mandal-assets succeeded without error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      RAISE NOTICE 'PASS: non-admin insert into mandal-assets rejected (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;

reset role;
SQL

echo "== assertion: mandal-assets storage RLS — read is open to anon =="
ANON_OBJ_COUNT=$("${PSQL[@]}" -d "$DB_NAME" -tAc "set role anon; select count(*) from storage.objects where bucket_id = 'mandal-assets';")
if [ "$ANON_OBJ_COUNT" -lt 1 ]; then
  echo "FAIL: anon should be able to read at least 1 mandal-assets object, saw $ANON_OBJ_COUNT" >&2
  exit 1
fi
echo "PASS: anon read $ANON_OBJ_COUNT mandal-assets object(s) (public read policy works)"

echo "== assertion: Task 10 client_idempotency_key UNIQUE constraint rejects a duplicate key =="
# Run last (after every earlier row-count assertion has already executed) so
# these extra inserts can't skew the admin/volunteer row-count checks above.
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- enforce_insert_defaults() stamps mandal_id from app_mandal_id(), which
-- needs a session to resolve. Superuser still bypasses RLS, so this block
-- tests exactly what it tested before: trigger behaviour, not policies.
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin

DO $$
BEGIN
  INSERT INTO donations (donor_name, amount_paise, mode, collected_by, client_idempotency_key)
    VALUES ('Idempotency Test Donor', 100, 'cash', '00000000-0000-0000-0000-000000000001', 'idem-test-key-1');

  BEGIN
    INSERT INTO donations (donor_name, amount_paise, mode, collected_by, client_idempotency_key)
      VALUES ('Idempotency Test Donor 2', 200, 'cash', '00000000-0000-0000-0000-000000000001', 'idem-test-key-1');
    RAISE EXCEPTION 'FAIL: duplicate client_idempotency_key was accepted — UNIQUE constraint missing';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: client_idempotency_key UNIQUE constraint rejects a duplicate key (%)', SQLERRM;
  END;
END $$;
SQL

echo "== assertion: Task 10 regression — client_idempotency_key is append-only after creation =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
DO $$
BEGIN
  BEGIN
    UPDATE donations SET client_idempotency_key = 'changed-key' WHERE client_idempotency_key = 'idem-test-key-1';
    RAISE EXCEPTION 'TRIGGER TEST FAILED: client_idempotency_key update succeeded but should have been blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%append-only%' THEN
      RAISE NOTICE 'PASS: trigger blocked donations.client_idempotency_key edit (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
SQL

echo "== assertion: Task 12 list_admins() is callable by a volunteer, hides inactive admins, and never leaks volunteer rows =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Inactive admin: proves "active admins only" is enforced, not just
-- "role = 'admin'". A fresh row/identity, isolated from the seed admin.
insert into users (id, mandal_id, name, role, email, active) values
  ('00000000-0000-0000-0000-000000000096', '11111111-1111-1111-1111-000000000001', 'Inactive Admin', 'admin', 'inactive-admin@example.com', false);

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- Volunteer One
DO $$
DECLARE
  leaked_volunteer_count int;
BEGIN
  -- Not asserting an exact total count: earlier assertions in this script
  -- (e.g. link_admin_account's "Link Test Admin") already added active
  -- admin rows, so the table isn't in a pristine seed-only state here.
  -- Instead assert on presence/absence of specific named rows.
  ASSERT EXISTS (SELECT 1 FROM list_admins() WHERE name = 'Admin Treasurer'),
    'FAIL: list_admins() did not return the seeded active admin';

  SELECT count(*) INTO leaked_volunteer_count
  FROM list_admins() WHERE name IN ('Volunteer One', 'Volunteer Two');
  ASSERT leaked_volunteer_count = 0,
    'FAIL: list_admins() leaked a volunteer row';

  ASSERT NOT EXISTS (SELECT 1 FROM list_admins() WHERE name = 'Inactive Admin'),
    'FAIL: list_admins() returned an inactive admin';

  RAISE NOTICE 'PASS: a volunteer session can call list_admins(), sees the active admin(s), and no volunteer/inactive-admin rows leak through';
END $$;
reset role;
SQL

echo "== assertion: Task 12 list_admins() is not exposed to anon =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role anon;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM list_admins();
    RAISE EXCEPTION 'SECURITY HOLE: anon was able to call list_admins() without error';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: anon is rejected from calling list_admins() (%)', SQLERRM;
  END;
END $$;
reset role;
SQL

echo "== assertion: Task 16 transparency report is gated on transparency_published; admin previews regardless =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- enforce_insert_defaults() stamps mandal_id from app_mandal_id(), which
-- needs a session to resolve. These setup inserts land in mandal one.
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin

-- Own isolated expense rows (a fresh category), so the category breakdown
-- assertion below has a known, exact expected row rather than depending on
-- whatever earlier assertions left behind.
insert into expenses (category, amount_paise, paid_by, paid_from) values
  ('Transparency Test', 12345, '00000000-0000-0000-0000-000000000001', 'cash');

-- enforce_insert_defaults (Task 2 migration) unconditionally forces
-- voided=false on INSERT regardless of what's sent — void after the fact via
-- void_row(), the only void path now (audit #2), which stamps voided_by
-- server-side from the admin session set above.
insert into expenses (category, amount_paise, paid_by, paid_from) values
  ('Transparency Test', 99999999, '00000000-0000-0000-0000-000000000001', 'cash');
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM expenses
    WHERE amount_paise = 99999999 AND category = 'Transparency Test';
  PERFORM void_row('expenses', v_id, 'test row, must be excluded');
END $$;

-- Drop the session claim too, not just the role: auth.uid() reads the
-- jwt claim set at the top of this block, and a lingering admin claim
-- would flip is_admin() on and hand 'anon' the admin preview bypass �
-- turning this leak test green for entirely the wrong reason.
set request.jwt.claim.sub = '';
set role anon;
DO $$
DECLARE
  row_count int;
BEGIN
  SELECT count(*) INTO row_count FROM get_transparency_report('mandal-one');
  ASSERT row_count = 0, format('FAIL: unpublished report should return 0 rows to anon, saw %s', row_count);

  SELECT count(*) INTO row_count FROM get_transparency_categories('mandal-one');
  ASSERT row_count = 0, format('FAIL: unpublished categories should return 0 rows to anon, saw %s', row_count);

  RAISE NOTICE 'PASS: anon sees 0 rows from both transparency RPCs before publish';
END $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- Admin Treasurer
DO $$
DECLARE
  row_count int;
  category_amount bigint;
BEGIN
  SELECT count(*) INTO row_count FROM get_transparency_report('mandal-one');
  ASSERT row_count = 1, format('FAIL: admin preview of the report should return 1 row even unpublished, saw %s', row_count);

  SELECT amount_paise INTO category_amount FROM get_transparency_categories('mandal-one') WHERE category = 'Transparency Test';
  ASSERT category_amount = 12345,
    format('FAIL: admin preview category total should be 12345 (voided row excluded), saw %s', category_amount);

  RAISE NOTICE 'PASS: admin preview bypasses the publish gate and excludes the voided expense from the category sum';
END $$;
SQL

echo "== assertion: Task 16 publishing (via the admin RLS update policy) makes the report visible to anon =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- Admin Treasurer
-- `where id = true` targeted the old boolean singleton PK. Scope to the
-- admin's own mandal now � mandals_admin_update's RLS would reject anything
-- else anyway, which is the policy this assertion exercises.
update mandals set transparency_published = true where id = app_mandal_id();
reset role;

-- Clear the claim, not just the role: a lingering admin claim would give
-- 'anon' the is_admin() preview bypass and prove nothing about publishing.
set request.jwt.claim.sub = '';
set role anon;
DO $$
DECLARE
  row_count int;
  category_amount bigint;
BEGIN
  SELECT count(*) INTO row_count FROM get_transparency_report('mandal-one');
  ASSERT row_count = 1, format('FAIL: published report should return 1 row to anon, saw %s', row_count);

  SELECT amount_paise INTO category_amount FROM get_transparency_categories('mandal-one') WHERE category = 'Transparency Test';
  ASSERT category_amount = 12345,
    format('FAIL: published category total should be 12345 (voided row excluded), saw %s', category_amount);

  RAISE NOTICE 'PASS: after publishing, anon sees the aggregate report and excludes the voided expense from the category sum';
END $$;
reset role;
SQL

echo "== assertion: F5 transparency_visibility gates the PUBLISHED report by audience =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- mandal-one is published (previous assertion set transparency_published=true).
-- Exercise each visibility value through the admin RLS update policy, then read
-- the report as anon / a member volunteer / this mandal's admin / another
-- mandal's admin. Publish stays a separate toggle — visibility narrows WHO of
-- the public may see an already-published report.

-- members: any signed-in member of THIS mandal (admin or volunteer); anon and
-- other mandals excluded.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
update mandals set transparency_visibility = 'members' where id = app_mandal_id();
reset role;

-- Clear the claim before dropping to anon (a lingering admin claim would hand
-- anon the is_admin() preview bypass — see the publish block above).
set request.jwt.claim.sub = '';
set role anon;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM get_transparency_report('mandal-one');
  ASSERT n = 0, format('FAIL: members-only report must be hidden from anon, saw %s', n);
END $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- Volunteer One (member of mandal one)
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM get_transparency_report('mandal-one');
  ASSERT n = 1, format('FAIL: members-only report must be visible to a member volunteer, saw %s', n);
END $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal TWO admin (not a member of mandal one)
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM get_transparency_report('mandal-one');
  ASSERT n = 0, format('FAIL: members-only report must be hidden from another mandal''s admin, saw %s', n);
END $$;
reset role;

-- admins: only THIS mandal's admins; a member volunteer no longer qualifies.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
update mandals set transparency_visibility = 'admins' where id = app_mandal_id();
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- Volunteer One
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM get_transparency_report('mandal-one');
  ASSERT n = 0, format('FAIL: admins-only report must be hidden from a member volunteer, saw %s', n);
END $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM get_transparency_report('mandal-one');
  ASSERT n = 1, format('FAIL: admins-only report must be visible to this mandal''s admin, saw %s', n);
END $$;

-- disabled: nobody via the public path; the own-admin preview still renders so
-- the admin transparency screen keeps working.
update mandals set transparency_visibility = 'disabled' where id = app_mandal_id();
reset role;

set request.jwt.claim.sub = '';
set role anon;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM get_transparency_report('mandal-one');
  ASSERT n = 0, format('FAIL: disabled report must be hidden from anon, saw %s', n);
  SELECT count(*) INTO n FROM get_transparency_categories('mandal-one');
  ASSERT n = 0, format('FAIL: disabled categories must be hidden from anon, saw %s', n);
END $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM get_transparency_report('mandal-one');
  ASSERT n = 1, format('FAIL: disabled report must still preview to this mandal''s admin, saw %s', n);
END $$;

-- Restore 'public' so downstream assertions see the same published+public
-- state the earlier publish assertion left.
update mandals set transparency_visibility = 'public' where id = app_mandal_id();
reset role;
SQL

echo "== assertion: new-issue #3 deactivated users are fully locked out (app_user_id/role/mandal_id) =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Throwaway admin + volunteer in mandal one, each with a real auth identity, so
-- we can prove an ACTIVE user resolves and a DEACTIVATED one loses EVERYTHING —
-- not just visibility in lists. This is the assertion that fails if only
-- app_user_id() is gated and is_admin()/app_mandal_id() are left ungated.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'active-gate-admin@example.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000f2', null);
insert into users (id, mandal_id, name, role, email, auth_user_id, active) values
  ('00000000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-000000000001',
   'Active Gate Admin', 'admin', 'active-gate-admin@example.com', 'aaaaaaaa-0000-0000-0000-0000000000f1', true);
insert into users (id, mandal_id, name, role, invite_token, auth_user_id, active) values
  ('00000000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-000000000001',
   'Active Gate Volunteer', 'volunteer', 'active-gate-vol-token', 'aaaaaaaa-0000-0000-0000-0000000000f2', true);

-- While ACTIVE: the admin's helpers all resolve.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000f1';
DO $$
BEGIN
  ASSERT app_user_id() = '00000000-0000-0000-0000-0000000000f1', 'FAIL: active admin app_user_id() unresolved';
  ASSERT is_admin(), 'FAIL: active admin is_admin() should be true';
  ASSERT app_mandal_id() = '11111111-1111-1111-1111-000000000001', 'FAIL: active admin app_mandal_id() unresolved';
END $$;
reset role;

-- Deactivate both (superuser update, modelling an admin flipping users.active).
update users set active = false where id in
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2');

-- While INACTIVE: the deactivated admin is no longer an admin, has no user id,
-- and no mandal scope, so mandals RLS (is_admin() AND id = app_mandal_id())
-- shows nothing.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000f1';
DO $$
DECLARE n int;
BEGIN
  ASSERT app_user_id() IS NULL, 'FAIL: deactivated admin still resolves app_user_id()';
  ASSERT app_user_role() IS NULL, 'FAIL: deactivated admin still resolves app_user_role()';
  ASSERT NOT is_admin(), 'FAIL: deactivated admin still passes is_admin() — not locked out';
  ASSERT app_mandal_id() IS NULL, 'FAIL: deactivated admin still resolves app_mandal_id()';
  SELECT count(*) INTO n FROM mandals;
  ASSERT n = 0, format('FAIL: deactivated admin can still read mandals (%s rows)', n);
END $$;
reset role;

-- The deactivated volunteer loses collect access: their own donations
-- (collected_by = app_user_id()) become unreadable.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000f2';
DO $$
DECLARE n int;
BEGIN
  ASSERT app_user_id() IS NULL, 'FAIL: deactivated volunteer still resolves app_user_id()';
  SELECT count(*) INTO n FROM donations;
  ASSERT n = 0, format('FAIL: deactivated volunteer can still read donations (%s rows)', n);
  RAISE NOTICE 'PASS: deactivated users lose app_user_id/role/mandal_id and all row access';
END $$;
reset role;

-- Remove the throwaway users so later count-based assertions are unaffected.
delete from users where id in
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2');
SQL

echo "== assertion: a volunteer can read expense_categories via RPC even though mandals itself is admin-only =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- Volunteer One
DO $$
DECLARE
  categories text[];
BEGIN
  -- Confirms the gap this migration fixes: mandals has no
  -- volunteer-facing RLS policy, so a direct select returns nothing even
  -- for this same volunteer session.
  ASSERT NOT EXISTS (SELECT 1 FROM mandals), 'FAIL: expected mandals direct select to be empty for a volunteer';

  SELECT get_expense_categories() INTO categories;
  ASSERT categories IS NOT NULL AND array_length(categories, 1) > 0,
    'FAIL: get_expense_categories() should return the mandal''s categories to a volunteer';
  RAISE NOTICE 'PASS: a volunteer session reads expense_categories via RPC (% categories) despite mandals RLS being admin-only', array_length(categories, 1);
END $$;
reset role;
SQL

echo "== assertion: get_expense_categories() is not exposed to anon =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role anon;
DO $$
BEGIN
  BEGIN
    PERFORM get_expense_categories();
    RAISE EXCEPTION 'SECURITY HOLE: anon was able to call get_expense_categories() without error';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: anon is rejected from calling get_expense_categories() (%)', SQLERRM;
  END;
END $$;
reset role;
SQL

echo "== assertion: TENANT ISOLATION — mandal two's admin cannot see mandal one =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Mandal one already has donations/expenses from the assertions above.
-- Give mandal two's admin a real session and prove none of it is reachable.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- Other Admin, mandal two

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM donations
   WHERE mandal_id = '11111111-1111-1111-1111-000000000001';
  ASSERT v_count = 0, format('LEAK: mandal two admin saw %s of mandal one''s donations', v_count);

  SELECT count(*) INTO v_count FROM expenses
   WHERE mandal_id = '11111111-1111-1111-1111-000000000001';
  ASSERT v_count = 0, format('LEAK: mandal two admin saw %s of mandal one''s expenses', v_count);

  SELECT count(*) INTO v_count FROM handovers
   WHERE mandal_id = '11111111-1111-1111-1111-000000000001';
  ASSERT v_count = 0, format('LEAK: mandal two admin saw %s of mandal one''s handovers', v_count);

  SELECT count(*) INTO v_count FROM users
   WHERE mandal_id = '11111111-1111-1111-1111-000000000001';
  ASSERT v_count = 0, format('LEAK: mandal two admin saw %s of mandal one''s users', v_count);

  SELECT count(*) INTO v_count FROM mandals
   WHERE id = '11111111-1111-1111-1111-000000000001';
  ASSERT v_count = 0, 'LEAK: mandal two admin can read mandal one''s mandals row';

  -- Their own mandal must still be fully visible — an isolation test that
  -- passes because the admin sees NOTHING proves nothing.
  SELECT count(*) INTO v_count FROM mandals
   WHERE id = '22222222-2222-2222-2222-000000000002';
  ASSERT v_count = 1, 'FAIL: mandal two admin cannot read their OWN mandal row';

  SELECT count(*) INTO v_count FROM list_admins() WHERE name = 'Admin Treasurer';
  ASSERT v_count = 0, 'LEAK: list_admins() returned another mandal''s admin';

  SELECT count(*) INTO v_count FROM list_admins() WHERE name = 'Other Admin';
  ASSERT v_count = 1, 'FAIL: list_admins() should return the caller''s own mandal admin';

  RAISE NOTICE 'PASS: mandal two admin is fully isolated from mandal one, and still sees their own';
END $$;
reset role;
SQL

echo "== assertion: TENANT ISOLATION — admin cannot preview another mandal's unpublished report =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- mandal-one was published by the Task 16 assertions above; mandal-two is
-- still unpublished, so it's the one to probe for the cross-mandal bypass.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal ONE admin

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM get_transparency_report('mandal-two');
  ASSERT v_count = 0, 'LEAK: an admin previewed another mandal''s unpublished totals';

  SELECT count(*) INTO v_count FROM get_transparency_categories('mandal-two');
  ASSERT v_count = 0, 'LEAK: an admin previewed another mandal''s unpublished categories';

  -- Same admin, own mandal: the preview bypass must still work.
  SELECT count(*) INTO v_count FROM get_transparency_report('mandal-one');
  ASSERT v_count = 1, 'FAIL: admin lost the preview of their OWN mandal';

  -- An unknown slug must look identical to an unpublished one.
  SELECT count(*) INTO v_count FROM get_transparency_report('no-such-mandal');
  ASSERT v_count = 0, 'FAIL: unknown slug should return zero rows';

  RAISE NOTICE 'PASS: cross-mandal transparency preview blocked; own-mandal preview intact';
END $$;
reset role;
SQL

echo "== assertion: TENANT ISOLATION — mandal_id is stamped from the session, not the client =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin

-- Forge mandal_id: claim this donation belongs to mandal two. The trigger
-- must overwrite it with the session's own mandal.
insert into donations (mandal_id, donor_name, amount_paise, mode, collected_by)
  values ('22222222-2222-2222-2222-000000000002', 'Forged Mandal Id', 100, 'cash',
          '00000000-0000-0000-0000-000000000001');

DO $$
DECLARE
  v_mandal uuid;
BEGIN
  SELECT mandal_id INTO v_mandal FROM donations WHERE donor_name = 'Forged Mandal Id';
  ASSERT v_mandal = '11111111-1111-1111-1111-000000000001',
    format('SECURITY HOLE: client-forged mandal_id was honoured (row landed in %s)', v_mandal);
  RAISE NOTICE 'PASS: forged mandal_id overridden by the insert trigger';
END $$;
reset role;
SQL

echo "== assertion: TENANT ISOLATION — receipt numbers are per-mandal and gapless =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Mandal two has issued no receipts yet, so its first donation must be
-- receipt #1 even though mandal one has already issued several.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin

insert into donations (donor_name, amount_paise, mode, collected_by)
  values ('M2 First Donor', 100, 'cash', '00000000-0000-0000-0000-0000000000b1');

DO $$
DECLARE
  v_no bigint;
BEGIN
  SELECT receipt_no INTO v_no FROM donations WHERE donor_name = 'M2 First Donor';
  ASSERT v_no = 1, format('FAIL: mandal two''s first receipt should be 1, got %s', v_no);
END $$;

insert into donations (donor_name, amount_paise, mode, collected_by)
  values ('M2 Second Donor', 100, 'cash', '00000000-0000-0000-0000-0000000000b1');

DO $$
DECLARE
  v_no bigint;
BEGIN
  SELECT receipt_no INTO v_no FROM donations WHERE donor_name = 'M2 Second Donor';
  ASSERT v_no = 2, format('FAIL: mandal two''s second receipt should be 2, got %s', v_no);
  RAISE NOTICE 'PASS: receipt numbers restart per mandal and increment gaplessly';
END $$;
reset role;

-- Both mandals now legitimately own a receipt #1 — the composite unique
-- constraint must permit exactly that. Asserted per-mandal rather than as a
-- global count(*), which any additional seeded mandal would inflate.
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM donations
                  WHERE mandal_id = '11111111-1111-1111-1111-000000000001' AND receipt_no = 1),
    'FAIL: mandal one has no receipt #1';
  ASSERT EXISTS (SELECT 1 FROM donations
                  WHERE mandal_id = '22222222-2222-2222-2222-000000000002' AND receipt_no = 1),
    'FAIL: mandal two has no receipt #1';
  RAISE NOTICE 'PASS: two mandals can each hold receipt #1 (unique is per-mandal)';
END $$;
SQL

echo "== assertion: the demo mandal's report is publicly readable =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- The landing page's "See a sample report" CTA points at /transparency/demo
-- for an anonymous visitor. If this returns nothing, that CTA renders "not
-- published yet" to every prospect who clicks it.
set request.jwt.claim.sub = '';
set role anon;
DO $$
DECLARE
  v_total bigint;
  v_cats  int;
BEGIN
  SELECT total_collected_paise INTO v_total FROM get_transparency_report('demo');
  ASSERT v_total > 0, 'FAIL: demo mandal report is empty or unpublished to anon';

  SELECT count(*) INTO v_cats FROM get_transparency_categories('demo');
  ASSERT v_cats >= 3, format('FAIL: demo spend breakdown needs enough categories to chart, saw %s', v_cats);
  RAISE NOTICE 'PASS: anon sees the demo report (₹% collected, % categories)', v_total / 100, v_cats;
END $$;
reset role;

-- The demo mandal must not be loggable-into: its team rows exist only to
-- satisfy collected_by/paid_by foreign keys.
DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM users
     WHERE mandal_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
       AND (auth_user_id IS NOT NULL OR email IS NOT NULL OR invite_token IS NOT NULL)
  ), 'SECURITY HOLE: a demo mandal user has a way to authenticate';
  RAISE NOTICE 'PASS: demo mandal has no authenticatable users';
END $$;
SQL

echo "== assertion: TENANT ISOLATION — an admin invites into their OWN mandal by default =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- users has no insert trigger, so mandal_id comes from the column default
-- (app_mandal_id()). This is the real path settings/volunteers.tsx uses:
-- it inserts name/phone/role/invite_token and nothing else.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin

insert into users (name, phone, role, invite_token, active)
  values ('Invited By M2', '9000000099', 'volunteer', 'invite-default-test', true);

DO $$
DECLARE
  v_mandal uuid;
BEGIN
  SELECT mandal_id INTO v_mandal FROM users WHERE name = 'Invited By M2';
  ASSERT v_mandal = '22222222-2222-2222-2222-000000000002',
    format('FAIL: invited volunteer landed in %s, not the inviting admin''s mandal', v_mandal);
  RAISE NOTICE 'PASS: an invited volunteer defaults into the inviting admin''s mandal';
END $$;

-- And an admin must not be able to invite INTO another mandal by forging it.
DO $$
BEGIN
  BEGIN
    insert into users (mandal_id, name, role, invite_token, active)
      values ('11111111-1111-1111-1111-000000000001', 'Cross Mandal Invite', 'volunteer',
              'invite-cross-test', true);
    RAISE EXCEPTION 'SECURITY HOLE: an admin invited a user into another mandal';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: cross-mandal invite rejected by users_admin_insert (%)', SQLERRM;
  END;
END $$;
reset role;
SQL

echo "== assertion: create_mandal() guards =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'newfounder@example.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c2', 'devanagari@example.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c3', 'dupname@example.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c4', 'hint@example.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c5', 'collide@example.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c6', 'shortname@example.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c7', 'longname@example.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c8', 'longname2@example.com')
on conflict (id) do nothing;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c1';
set request.jwt.claims = '{"is_anonymous": false}';

DO $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  v_id := create_mandal('Shivaji Nagar Mandal', 'New Founder');
  SELECT slug INTO v_slug FROM mandals WHERE id = v_id;
  ASSERT v_slug = 'shivaji-nagar-mandal', format('FAIL: unexpected slug %s', v_slug);

  ASSERT EXISTS (SELECT 1 FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000c1'
                   AND role = 'admin' AND mandal_id = v_id),
    'FAIL: create_mandal did not create the first admin';

  -- The one-mandal-per-email cap.
  BEGIN
    PERFORM create_mandal('Second Mandal', 'New Founder');
    RAISE EXCEPTION 'FAIL: a second create_mandal for the same account succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%already belongs to a mandal%' THEN
      RAISE NOTICE 'PASS: one-mandal-per-email cap held';
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- A mandal named entirely in Devanagari must still get a valid slug: for a
-- Ganesh mandal app this is the normal case, not an exotic one.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c2';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  -- With no hint, a wholly-Devanagari name can only reach the generic
  -- fallback. It must still be valid and unique — never '' or a constraint
  -- violation — because this is the target market's default case.
  v_id := create_mandal('गणेश मंडळ', 'Devanagari Founder');
  SELECT slug INTO v_slug FROM mandals WHERE id = v_id;
  ASSERT v_slug ~ '^[a-z0-9][a-z0-9-]{1,39}$',
    format('FAIL: Devanagari name produced an invalid slug: %s', v_slug);
  RAISE NOTICE 'PASS: Devanagari name with no hint fell back to a valid slug (%)', v_slug;
END $$;
reset role;

-- The reason slug_hint exists: a Devanagari-named mandal must be able to
-- get a READABLE link, not 'mandal-3'. Without this the slug column buys
-- nothing for exactly the mandals this app is for.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c4';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  v_id := create_mandal('श्री गणेश मंडळ', 'Hint Founder', 'shree-ganesh-pune');
  SELECT slug INTO v_slug FROM mandals WHERE id = v_id;
  ASSERT v_slug = 'shree-ganesh-pune',
    format('FAIL: slug_hint should win over the name fallback, got %s', v_slug);
  RAISE NOTICE 'PASS: Devanagari-named mandal got a readable slug from its hint (%)', v_slug;
END $$;
reset role;

-- A hint is a candidate, not a command: it is slugified and uniqueness-
-- checked like any other. A hint colliding with an existing slug must
-- suffix, not overwrite or error.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c5';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  v_id := create_mandal('Another Mandal', 'Collide Founder', 'Shree Ganesh Pune!!');
  SELECT slug INTO v_slug FROM mandals WHERE id = v_id;
  ASSERT v_slug = 'shree-ganesh-pune-2',
    format('FAIL: colliding hint should suffix, got %s', v_slug);
  RAISE NOTICE 'PASS: unsanitised colliding hint slugified and suffixed to %', v_slug;
END $$;
reset role;

-- A second mandal with the SAME name must get a distinct slug, not collide.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c3';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  v_id := create_mandal('Shivaji Nagar Mandal', 'Dup Name Founder');
  SELECT slug INTO v_slug FROM mandals WHERE id = v_id;
  ASSERT v_slug = 'shivaji-nagar-mandal-2',
    format('FAIL: duplicate mandal name should get -2 suffix, got %s', v_slug);
  RAISE NOTICE 'PASS: duplicate mandal name resolved to %', v_slug;
END $$;
reset role;

-- Slug length bounds: the check constraint demands 2..40 chars. A name that
-- slugifies to a single character, and a long name whose collision suffix
-- would push it past 40, both have to work — a founder must never see a raw
-- check_violation from a legal mandal name.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c6';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  v_id := create_mandal('A', 'Short Name Founder');
  SELECT slug INTO v_slug FROM mandals WHERE id = v_id;
  ASSERT v_slug ~ '^[a-z0-9][a-z0-9-]{1,39}$',
    format('FAIL: single-character name produced an invalid slug: %s', v_slug);
  RAISE NOTICE 'PASS: single-character mandal name produced slug %', v_slug;
END $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c7';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  -- 46 chars: slugifies past the 40-char bound, so it gets truncated.
  v_id := create_mandal('Shri Ganesh Mitra Mandal Sarvajanik Trust Pune', 'Long Name Founder');
  SELECT slug INTO v_slug FROM mandals WHERE id = v_id;
  ASSERT length(v_slug) <= 40, format('FAIL: slug exceeded 40 chars: %s', v_slug);
  RAISE NOTICE 'PASS: long name truncated to %', v_slug;
END $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c8';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  -- The SAME long name again: the collision suffix must not push the slug
  -- past the constraint's 40-char ceiling.
  v_id := create_mandal('Shri Ganesh Mitra Mandal Sarvajanik Trust Pune', 'Long Name Founder Two');
  SELECT slug INTO v_slug FROM mandals WHERE id = v_id;
  ASSERT v_slug ~ '^[a-z0-9][a-z0-9-]{1,39}$',
    format('FAIL: colliding long name produced an invalid slug: %s', v_slug);
  RAISE NOTICE 'PASS: colliding long name resolved to %', v_slug;
END $$;
reset role;

-- An anonymous (volunteer) session must never create a mandal.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
set request.jwt.claims = '{"is_anonymous": true}';
DO $$
BEGIN
  BEGIN
    PERFORM create_mandal('Anon Mandal', 'Anon');
    RAISE EXCEPTION 'SECURITY HOLE: an anonymous session created a mandal';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%anonymous%' THEN
      RAISE NOTICE 'PASS: anonymous session rejected by create_mandal()';
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;
SQL

echo "== assertion: get_mandal_default_lang() is per-mandal and volunteer-readable =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role postgres;
update mandals set default_lang = 'mr' where id = '11111111-1111-1111-1111-000000000001';
update mandals set default_lang = 'gu' where id = '22222222-2222-2222-2222-000000000002';
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- Volunteer One, mandal one
DO $$
BEGIN
  -- A volunteer cannot read mandals directly, which is exactly why this RPC
  -- exists — the same gap get_expense_categories() closes.
  ASSERT NOT EXISTS (SELECT 1 FROM mandals),
    'FAIL: expected mandals direct select to be empty for a volunteer';
  ASSERT get_mandal_default_lang() = 'mr',
    format('FAIL: volunteer should read their own mandal''s default_lang, got %s', get_mandal_default_lang());
END $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin
DO $$
BEGIN
  ASSERT get_mandal_default_lang() = 'gu',
    'LEAK: get_mandal_default_lang() returned another mandal''s value';
  RAISE NOTICE 'PASS: get_mandal_default_lang() is scoped to the caller''s own mandal';
END $$;
reset role;
SQL

echo "== assertion: get_mandal_default_lang() is not exposed to anon =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set request.jwt.claim.sub = '';
set role anon;
DO $$
BEGIN
  BEGIN
    PERFORM get_mandal_default_lang();
    RAISE EXCEPTION 'SECURITY HOLE: anon called get_mandal_default_lang()';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: anon is rejected from get_mandal_default_lang() (%)', SQLERRM;
  END;
END $$;
reset role;
SQL

echo "== assertion: default_lang rejects an unsupported code =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
DO $$
BEGIN
  BEGIN
    UPDATE mandals SET default_lang = 'fr' WHERE id = '11111111-1111-1111-1111-000000000001';
    RAISE EXCEPTION 'FAIL: default_lang accepted an unsupported language code';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: default_lang check constraint rejects an unsupported code';
  END;
END $$;
SQL

echo "== assertion: void_row() authorization, server-side stamp, and one-wayness (audit #2) =="
# Insert the target as the setup superuser — RLS-invisible to a volunteer, so
# a volunteer session can't look the id up itself (same pattern as the anon
# receipt test), which is why the id is captured here and passed in literally.
VOIDROW_ID=$("${PSQL[@]}" -d "$DB_NAME" -tAc "insert into donations (mandal_id, donor_name, amount_paise, mode, collected_by) values ('11111111-1111-1111-1111-000000000001','VoidRow Target',100,'cash','00000000-0000-0000-0000-000000000001') returning id;")
if [ -z "$VOIDROW_ID" ]; then
  echo "FAIL: could not insert the void_row target" >&2
  exit 1
fi

# A volunteer voiding a donation that isn't theirs must be rejected.
VOID_ERR=$("${PSQL[@]}" -d "$DB_NAME" -tAc "set role authenticated; set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000002'; select void_row('donations','$VOIDROW_ID','not mine');" 2>&1 || true)
if echo "$VOID_ERR" | grep -qiE 'not yours to void|not found'; then
  echo "PASS: void_row rejects a non-owner, non-admin volunteer"
else
  echo "FAIL: a volunteer voided another's donation (or wrong error): $VOID_ERR" >&2
  exit 1
fi

"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM donations WHERE donor_name = 'VoidRow Target';
  ASSERT v_id IS NOT NULL, 'FAIL: admin cannot see the void_row target';

  PERFORM void_row('donations', v_id, 'admin voids it');
  ASSERT (SELECT voided FROM donations WHERE id = v_id) = true, 'FAIL: void_row did not void the row';
  ASSERT (SELECT voided_by FROM donations WHERE id = v_id) = '00000000-0000-0000-0000-000000000001',
    'FAIL: void_row did not stamp voided_by from the session';
  ASSERT (SELECT voided_at FROM donations WHERE id = v_id) IS NOT NULL,
    'FAIL: void_row did not stamp voided_at from the session';
  RAISE NOTICE 'PASS: void_row voids and stamps voided_by/voided_at server-side';

  -- One-way: a direct un-void UPDATE is rejected.
  BEGIN
    UPDATE donations SET voided = false, voided_by = null, voided_at = null, void_reason = null WHERE id = v_id;
    RAISE EXCEPTION 'SECURITY HOLE: a voided donation was un-voided by a direct UPDATE';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%void metadata%' OR SQLERRM LIKE '%voided row cannot be changed%' OR SQLERRM LIKE '%one-way%' THEN
      RAISE NOTICE 'PASS: voids are one-way — direct un-void rejected (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;

  -- Re-voiding an already-voided row via void_row is a raise, not a silent no-op.
  BEGIN
    PERFORM void_row('donations', v_id, 'again');
    RAISE EXCEPTION 'FAIL: void_row succeeded on an already-voided row';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%already voided%' OR SQLERRM LIKE '%not found%' THEN
      RAISE NOTICE 'PASS: void_row raises on an already-voided row (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;
SQL

echo "== assertion: TENANT ISOLATION — composite actor FK blocks a cross-mandal actor (audit #3) =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
DO $$
BEGIN
  BEGIN
    -- Disable the insert trigger so mandal_id isn't stamped from the session,
    -- letting us forge a (collected_by, mandal_id) pair that crosses tenants:
    -- collected_by is mandal TWO's admin, mandal_id is mandal ONE.
    ALTER TABLE donations DISABLE TRIGGER donations_enforce_insert;
    INSERT INTO donations (mandal_id, donor_name, amount_paise, mode, collected_by)
      VALUES ('11111111-1111-1111-1111-000000000001', 'Cross Mandal Actor', 100, 'cash',
              '00000000-0000-0000-0000-0000000000b1');
    ALTER TABLE donations ENABLE TRIGGER donations_enforce_insert;
    RAISE EXCEPTION 'SECURITY HOLE: a donation named collected_by from another mandal was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    ALTER TABLE donations ENABLE TRIGGER donations_enforce_insert;
    RAISE NOTICE 'PASS: composite FK rejects a cross-mandal collected_by (%)', SQLERRM;
  END;
END $$;
reset role;
SQL

echo "== assertion: reissue_invite() mints a fresh token and clears the old binding (audit #4) =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Runs LAST: it clears volunteer 002's auth_user_id, and 002 is used as a
-- live session by many assertions above.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
DO $$
DECLARE new_tok text;
BEGIN
  ASSERT (SELECT auth_user_id FROM users WHERE id = '00000000-0000-0000-0000-000000000002') IS NOT NULL,
    'FAIL: precondition — volunteer 002 should be bound before reissue';

  new_tok := reissue_invite('00000000-0000-0000-0000-000000000002');
  ASSERT new_tok IS NOT NULL AND length(new_tok) > 0, 'FAIL: reissue_invite returned no token';
  ASSERT (SELECT auth_user_id FROM users WHERE id = '00000000-0000-0000-0000-000000000002') IS NULL,
    'FAIL: reissue_invite did not clear the old binding';
  ASSERT (SELECT invite_token FROM users WHERE id = '00000000-0000-0000-0000-000000000002') = new_tok,
    'FAIL: reissue_invite did not set the new token';
  RAISE NOTICE 'PASS: reissue_invite minted a fresh token and cleared the binding';
END $$;
reset role;

-- A non-admin cannot reissue.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003'; -- a non-admin session
DO $$
BEGIN
  BEGIN
    PERFORM reissue_invite('00000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'SECURITY HOLE: a non-admin reissued an invite';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%only an admin%' THEN
      RAISE NOTICE 'PASS: reissue_invite rejects a non-admin (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;
SQL

echo "== all assertions passed =="
