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
  -- may have already added active admin rows, so the table isn't in a
  -- pristine seed-only state here. Instead assert on presence/absence of
  -- specific named rows.
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
insert into users (id, mandal_id, name, role, auth_user_id, active) values
  ('00000000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-000000000001',
   'Active Gate Volunteer', 'volunteer', 'aaaaaaaa-0000-0000-0000-0000000000f2', true);

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
       AND (auth_user_id IS NOT NULL OR email IS NOT NULL)
  ), 'SECURITY HOLE: a demo mandal user has a way to authenticate';
  RAISE NOTICE 'PASS: demo mandal has no authenticatable users';
END $$;
SQL

echo "== assertion: TENANT ISOLATION — an admin invites into their OWN mandal by default =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- No UI path inserts into `users` directly anymore (Task 2 moved that to
-- accept_invite, a SECURITY DEFINER RPC that bypasses RLS entirely) — this
-- now exercises the users_admin_insert RLS policy directly, proving it
-- still scopes/rejects by mandal_id on its own.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin

insert into users (name, phone, role, active)
  values ('Invited By M2', '9000000099', 'volunteer', true);

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
    insert into users (mandal_id, name, role, active)
      values ('11111111-1111-1111-1111-000000000001', 'Cross Mandal Invite', 'volunteer', true);
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

  -- v5 (20260720120000/20260720130000, already applied): create_mandal's
  -- founding row is now 'owner', not 'admin' — is_admin() covers both, so
  -- every downstream admin-only check in this script still holds for an
  -- owner. The old one-mandal-per-email cap tested here is gone too, not
  -- ported (see that migration's own header comment): auth_user_id/email
  -- are unique only WITHIN a mandal now, so belonging to more than one
  -- mandal is correct v5 behaviour, not something to guard against.
  ASSERT EXISTS (SELECT 1 FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000c1'
                   AND role = 'owner' AND mandal_id = v_id),
    'FAIL: create_mandal did not create the first owner';
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

echo "== assertion: v3 get_public_receipt withholds the president phone server-side per the hide rule =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
DO $$
DECLARE
  tok text;
  ph  text;
BEGIN
  -- A fresh mandal-one donation; public_token is generated by the insert
  -- trigger. get_public_receipt is security definer, so calling it as this
  -- session returns exactly what an anon donor would see over the wire.
  insert into donations (donor_name, donor_phone, amount_paise, mode, collected_by)
    values ('Phone Rule Donor', '9999999999', 5000, 'cash', '00000000-0000-0000-0000-000000000001')
    returning public_token into tok;

  -- not hidden -> phone is public
  update mandals set creator_phone = '9000000001', inquiry_contacts = '[]'::jsonb, hide_president_contact = false
    where id = app_mandal_id();
  select creator_phone into ph from get_public_receipt(tok);
  ASSERT ph = '9000000001', format('FAIL: not-hidden receipt should carry creator_phone, saw %s', ph);

  -- hidden but the president is the ONLY contact -> still shown (someone must
  -- be reachable)
  update mandals set hide_president_contact = true, inquiry_contacts = '[]'::jsonb where id = app_mandal_id();
  select creator_phone into ph from get_public_receipt(tok);
  ASSERT ph = '9000000001', format('FAIL: hidden-but-sole-contact should still carry creator_phone, saw %s', ph);

  -- hidden AND another contact exists -> phone is withheld IN THE RPC (the v2
  -- leak this migration closes)
  update mandals set hide_president_contact = true,
                     inquiry_contacts = '[{"name":"Suresh","phone":"9876500000"}]'::jsonb
    where id = app_mandal_id();
  select creator_phone into ph from get_public_receipt(tok);
  ASSERT ph IS NULL, format('FAIL: hidden-with-other-contact must NULL creator_phone in the RPC (leak!), saw %s', ph);

  -- shown again once un-hidden, even with another contact present
  update mandals set hide_president_contact = false where id = app_mandal_id();
  select creator_phone into ph from get_public_receipt(tok);
  ASSERT ph = '9000000001', format('FAIL: un-hidden receipt should carry creator_phone, saw %s', ph);

  RAISE NOTICE 'PASS: get_public_receipt withholds the president phone server-side per the hide rule';
END $$;
reset role;
SQL

echo "== assertion: v3 inquiry_contacts is capped at 2 array entries by a DB CHECK =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
DO $$
BEGIN
  BEGIN
    update mandals set inquiry_contacts =
      '[{"name":"a","phone":"1"},{"name":"b","phone":"2"},{"name":"c","phone":"3"}]'::jsonb
      where id = app_mandal_id();
    RAISE EXCEPTION 'FAIL: inquiry_contacts with 3 entries was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: a 3-entry inquiry_contacts is rejected by the CHECK';
  END;

  BEGIN
    update mandals set inquiry_contacts = '"not-an-array"'::jsonb where id = app_mandal_id();
    RAISE EXCEPTION 'FAIL: a non-array inquiry_contacts was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: a non-array inquiry_contacts is rejected by the CHECK';
  END;
END $$;
reset role;
SQL

echo "== assertion: v4 donations.category is stored on insert but append-only after =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
DO $$
DECLARE did uuid;
BEGIN
  insert into donations (donor_name, amount_paise, mode, category, collected_by)
    values ('Category Guard Donor', 500, 'cash', 'shop', '00000000-0000-0000-0000-000000000001')
    returning id into did;
  ASSERT (select category from donations where id = did) = 'shop', 'FAIL: category not stored on insert';

  BEGIN
    update donations set category = 'other' where id = did;
    RAISE EXCEPTION 'FAIL: donations.category was editable after insert';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%append-only%' THEN
      RAISE NOTICE 'PASS: donations.category is append-only (void + re-enter to change)';
    ELSE RAISE; END IF;
  END;
END $$;
reset role;
SQL

echo "== assertion: v4 donors_summary aggregates for the admin only, mandal-scoped =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
DO $$
DECLARE tot bigint; cnt bigint; n int;
BEGIN
  insert into donations (donor_name, donor_phone, amount_paise, mode, collected_by) values
    ('Repeat Donor', '9111111111', 1000, 'cash', '00000000-0000-0000-0000-000000000001'),
    ('Repeat Donor', '9111111111', 2000, 'upi',  '00000000-0000-0000-0000-000000000001');

  -- donors_summary returns the NORMALIZED phone (20260719150000), so a bare
  -- 10-digit stored value comes back as +91…
  SELECT total_paise, donation_count INTO tot, cnt FROM donors_summary() WHERE donor_phone = '+919111111111';
  ASSERT tot = 3000, format('FAIL: donor total should be 3000, saw %s', tot);
  ASSERT cnt = 2, format('FAIL: donor donation_count should be 2, saw %s', cnt);

  SELECT count(*) INTO n FROM donors_summary(1999); -- no donations in 1999
  ASSERT n = 0, format('FAIL: year filter should exclude other years, saw %s rows for 1999', n);
  RAISE NOTICE 'PASS: donors_summary aggregates by donor and honours the year filter';
END $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- Volunteer One
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM donors_summary();
  ASSERT n = 0, format('FAIL: a volunteer must see no donor directory, saw %s', n);
END $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM donors_summary() WHERE donor_phone = '+919111111111';
  ASSERT n = 0, format('FAIL: another mandal admin must not see mandal-one donors, saw %s', n);
  RAISE NOTICE 'PASS: donors_summary is admin-only and mandal-scoped';
END $$;
reset role;
SQL

echo "== assertion: v4 donors_summary merges a legacy 10-digit donor with their E.164 twin =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
DO $$
DECLARE n int; tot bigint; cnt bigint; ph text;
BEGIN
  -- The same human: one row stored pre-v4 (bare 10-digit) and one stored after
  -- the E.164 switch. They MUST aggregate as a single donor, or the directory
  -- contradicts the dashboard's unique-donor count at the migration boundary.
  insert into donations (donor_name, donor_phone, amount_paise, mode, collected_by) values
    ('Twin Donor', '9000000077',    1000, 'cash', '00000000-0000-0000-0000-000000000001'),
    ('Twin Donor', '+919000000077', 2500, 'upi',  '00000000-0000-0000-0000-000000000001');

  SELECT count(*) INTO n FROM donors_summary() WHERE donor_name = 'Twin Donor';
  ASSERT n = 1, format('FAIL: legacy + E.164 rows should be ONE donor, saw %s rows', n);

  SELECT donor_phone, total_paise, donation_count INTO ph, tot, cnt
    FROM donors_summary() WHERE donor_name = 'Twin Donor';
  ASSERT ph = '+919000000077', format('FAIL: merged donor phone should be normalized E.164, saw %s', ph);
  ASSERT tot = 3500, format('FAIL: merged donor total should be 3500, saw %s', tot);
  ASSERT cnt = 2, format('FAIL: merged donor count should be 2, saw %s', cnt);

  -- The normalizer itself, on the shapes real rows actually carry.
  ASSERT normalize_phone_e164('9876543210')     = '+919876543210', 'FAIL: bare 10-digit should become +91';
  ASSERT normalize_phone_e164('09876543210')    = '+919876543210', 'FAIL: trunk 0 should be stripped';
  ASSERT normalize_phone_e164('00919876543210') = '+919876543210', 'FAIL: 00 IDD prefix should be stripped';
  ASSERT normalize_phone_e164('+44 7911 123456') = '+447911123456', 'FAIL: E.164 should keep its own country code';
  ASSERT normalize_phone_e164('')  IS NULL, 'FAIL: blank should normalize to null';
  ASSERT normalize_phone_e164(null) IS NULL, 'FAIL: null should normalize to null';

  RAISE NOTICE 'PASS: donors_summary merges legacy/E.164 twins and normalize_phone_e164 handles trunk/IDD prefixes';
END $$;
reset role;
SQL

echo "== assertion: v4 donors_summary is not exposed to anon =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role anon;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM donors_summary();
    RAISE EXCEPTION 'SECURITY HOLE: anon called donors_summary()';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: anon is rejected from donors_summary()';
  END;
END $$;
reset role;
SQL

echo "== assertion: v4 purge_donations — role, scope, and tenant isolation =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- A volunteer cannot purge.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- Volunteer One
DO $$
BEGIN
  BEGIN
    PERFORM purge_donations('removed');
    RAISE EXCEPTION 'FAIL: a volunteer purged donations';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%only the owner%' THEN RAISE NOTICE 'PASS: a volunteer cannot purge';
    ELSE RAISE; END IF;
  END;
END $$;
reset role;

-- v5 (20260720120000, already applied): purge_donations moved from
-- admin-only to owner-only ("Danger zone moves to the owner"). Neither seed
-- admin below is an owner — that migration's owner backfill ran before
-- seed.sql existed — so promote the two this block exercises; this test is
-- about purge's scope/tenant-isolation properties, not the admin-vs-owner
-- boundary (already proved above), and nothing later in the script depends
-- on these two rows' role.
update users set role = 'owner' where id in
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1');

-- 'removed' scope erases only voided rows; invalid scope rejected.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
insert into donations (donor_name, amount_paise, mode, collected_by)
  values ('Purge Voided Donor', 700, 'cash', '00000000-0000-0000-0000-000000000001');
DO $$
DECLARE vid uuid; active_before int; voided_before int; removed_purged int;
BEGIN
  SELECT id INTO vid FROM donations
    WHERE donor_name = 'Purge Voided Donor' AND mandal_id = app_mandal_id() LIMIT 1;
  PERFORM void_row('donations', vid, 'to be purged');

  SELECT count(*) FILTER (WHERE not voided), count(*) FILTER (WHERE voided)
    INTO active_before, voided_before FROM donations WHERE mandal_id = app_mandal_id();
  ASSERT voided_before >= 1, 'FAIL: expected a voided row to purge';

  BEGIN
    PERFORM purge_donations('bogus');
    RAISE EXCEPTION 'FAIL: invalid purge scope accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invalid purge scope%' THEN RAISE NOTICE 'PASS: invalid scope rejected';
    ELSE RAISE; END IF;
  END;

  removed_purged := purge_donations('removed');
  ASSERT removed_purged = voided_before,
    format('FAIL: removed purge should delete %s voided rows, deleted %s', voided_before, removed_purged);
  ASSERT (SELECT count(*) FROM donations WHERE mandal_id = app_mandal_id() AND voided) = 0,
    'FAIL: voided rows survived the removed purge';
  ASSERT (SELECT count(*) FROM donations WHERE mandal_id = app_mandal_id() AND NOT voided) = active_before,
    'FAIL: removed purge deleted active rows';
  RAISE NOTICE 'PASS: purge_donations(removed) erases only voided rows';
END $$;
reset role;

-- Tenant isolation: mandal two's admin purging 'all' must not touch mandal one.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin
select purge_donations('all');
reset role;
DO $$
DECLARE n int;
BEGIN
  -- superuser (RLS bypassed): mandal one still holds its active donations
  SELECT count(*) INTO n FROM donations WHERE mandal_id = '11111111-1111-1111-1111-000000000001' AND NOT voided;
  ASSERT n >= 1, format('FAIL: mandal-two admin purge erased mandal-one donations (mandal one now has %s)', n);
  RAISE NOTICE 'PASS: purge_donations is mandal-scoped (other tenant untouched)';
END $$;

-- 'all' scope wipes the mandal's own history (last — leaves mandal one empty).
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin
DO $$
DECLARE purged int; remaining int;
BEGIN
  purged := purge_donations('all');
  ASSERT purged >= 1, 'FAIL: all purge deleted nothing';
  SELECT count(*) INTO remaining FROM donations WHERE mandal_id = app_mandal_id();
  ASSERT remaining = 0, format('FAIL: all purge left %s donations', remaining);
  RAISE NOTICE 'PASS: purge_donations(all) erases the entire mandal donation history';
END $$;
reset role;
SQL


echo "== assertion: create_mandal() creator becomes owner, not admin =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000d1', 'new-owner@example.com');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d1';
set request.jwt.claims = '{"is_anonymous": false}';
select create_mandal('Owner Test Mandal', 'New Owner');
reset role;

DO $$
BEGIN
  ASSERT (SELECT role FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000d1') = 'owner',
    'FAIL: create_mandal() creator should become owner, not admin';
  RAISE NOTICE 'PASS: create_mandal() creator becomes owner';
END $$;
SQL

echo "== assertion: users_one_owner_per_mandal — a second owner in the same mandal is rejected =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
DO $$
DECLARE m uuid;
BEGIN
  SELECT mandal_id INTO m FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000d1';
  BEGIN
    INSERT INTO users (mandal_id, name, role, active) VALUES (m, 'Second Owner', 'owner', true);
    RAISE EXCEPTION 'SECURITY HOLE: a mandal accepted a second owner row';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: users_one_owner_per_mandal rejects a second owner (%)', SQLERRM;
  END;
END $$;
SQL

echo "== assertion: multi-mandal membership — the SAME identity can own/join a SECOND mandal =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- This is the exact scenario the old global unique(auth_user_id)/unique(email)
-- made impossible. d1 already owns "Owner Test Mandal" above; founding a
-- second mandal as the same identity must now succeed.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d1';
set request.jwt.claims = '{"is_anonymous": false}';
select create_mandal('Second Mandal For Same Owner', 'New Owner');
reset role;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000d1';
  ASSERT n = 2, format('FAIL: same identity should now hold 2 memberships, saw %s', n);
  RAISE NOTICE 'PASS: one auth identity can belong to two different mandals';
END $$;
SQL

echo "== assertion: create_invite() — role gating (escalation attempts rejected) =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Mandal one's seed admin (001) is now its owner (Task 1 backfill); seed
-- volunteer 002 stays a volunteer throughout this file.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
DO $$
DECLARE tok text;
BEGIN
  tok := create_invite('volunteer', 'New Volunteer Invite');
  ASSERT tok IS NOT NULL AND length(tok) > 0, 'FAIL: owner could not invite a volunteer';
  tok := create_invite('admin', 'New Admin Invite');
  ASSERT tok IS NOT NULL AND length(tok) > 0, 'FAIL: owner could not invite an admin';
  RAISE NOTICE 'PASS: owner can invite both volunteer and admin';
END $$;
reset role;

-- Give mandal one a real (non-owner) admin to test the escalation boundary.
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000d2', 'plain-admin@example.com');
insert into users (id, mandal_id, name, role, email, auth_user_id, active) values
  ('00000000-0000-0000-0000-0000000000d2', '11111111-1111-1111-1111-000000000001',
   'Plain Admin', 'admin', 'plain-admin@example.com', 'aaaaaaaa-0000-0000-0000-0000000000d2', true);

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d2'; -- plain admin, not owner
DO $$
DECLARE tok text;
BEGIN
  tok := create_invite('volunteer', 'Admin-Invited Volunteer');
  ASSERT tok IS NOT NULL, 'FAIL: an admin could not invite a volunteer';

  BEGIN
    PERFORM create_invite('admin', 'Escalation Attempt');
    RAISE EXCEPTION 'SECURITY HOLE: a non-owner admin invited another admin';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%only the owner can invite an admin%' THEN
      RAISE NOTICE 'PASS: create_invite() blocks an admin from inviting an admin (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- A volunteer cannot invite anyone at all.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- mandal one volunteer (seed)
DO $$
BEGIN
  BEGIN
    PERFORM create_invite('volunteer', 'Volunteer Escalation Attempt');
    RAISE EXCEPTION 'SECURITY HOLE: a volunteer created an invite';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%only an owner or admin%' THEN
      RAISE NOTICE 'PASS: create_invite() blocks a volunteer (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;
SQL

echo "== assertion: invite_preview + accept_invite — the full join flow, and every rejection path =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- A live invite, minted the real way.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
DO $$
DECLARE tok text;
BEGIN
  tok := create_invite('volunteer', 'Join Flow Volunteer', 'join-flow@example.com');
  PERFORM set_config('verify.join_flow_token', tok, false);
END $$;
reset role;

-- invite_preview is anon-callable and names the mandal + role + invitee.
set request.jwt.claim.sub = '';
set role anon;
DO $$
DECLARE m text; r text; n_name text;
BEGIN
  SELECT mandal_name, role, invitee_name INTO m, r, n_name
    FROM invite_preview(current_setting('verify.join_flow_token'));
  ASSERT m = 'Vinayak Mitra Mandal', format('FAIL: invite_preview mandal_name wrong, saw %s', m);
  ASSERT r = 'volunteer', format('FAIL: invite_preview role wrong, saw %s', r);
  ASSERT n_name = 'Join Flow Volunteer', format('FAIL: invite_preview invitee_name wrong, saw %s', n_name);
  RAISE NOTICE 'PASS: invite_preview names mandal + role + invitee for a live token';
END $$;
reset role;

-- An anonymous session cannot accept.
insert into auth.users (id) values ('aaaaaaaa-0000-0000-0000-0000000000d3');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d3';
set request.jwt.claims = '{"is_anonymous": true}';
DO $$
BEGIN
  BEGIN
    PERFORM accept_invite(current_setting('verify.join_flow_token'));
    RAISE EXCEPTION 'SECURITY HOLE: an anonymous session accepted an invite';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%real Google or email account%' THEN
      RAISE NOTICE 'PASS: accept_invite() rejects an anonymous session (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Wrong email: this invite is locked to join-flow@example.com.
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000d4', 'wrong-person@example.com');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d4';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
BEGIN
  BEGIN
    PERFORM accept_invite(current_setting('verify.join_flow_token'));
    RAISE EXCEPTION 'SECURITY HOLE: accept_invite ignored the email lock';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%locked to a different email%' THEN
      RAISE NOTICE 'PASS: accept_invite() enforces the email lock (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- The real invitee accepts.
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000d5', 'join-flow@example.com');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d5';
set request.jwt.claims = '{"is_anonymous": false}';
select accept_invite(current_setting('verify.join_flow_token'));
reset role;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM users
     WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000d5'
       AND role = 'volunteer' AND name = 'Join Flow Volunteer'
       AND mandal_id = '11111111-1111-1111-1111-000000000001'
  ), 'FAIL: accept_invite() did not create the expected membership';
  ASSERT (SELECT consumed_at FROM invites WHERE token_hash = encode(extensions.digest(current_setting('verify.join_flow_token'), 'sha256'), 'hex')) IS NOT NULL,
    'FAIL: accept_invite() did not mark the invite consumed';
  RAISE NOTICE 'PASS: accept_invite() creates the membership and marks the invite consumed';
END $$;

-- Idempotent: the same person re-opening the (now consumed) link is a no-op
-- success, not an error.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d5';
set request.jwt.claims = '{"is_anonymous": false}';
select accept_invite(current_setting('verify.join_flow_token'));
reset role;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000d5') = 1,
    'FAIL: re-accepting an already-used link by the same person should be a no-op, not a duplicate';
  RAISE NOTICE 'PASS: accept_invite() is idempotent for the same person';
END $$;

-- A DIFFERENT person cannot then reuse the same (consumed) token.
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000d6', null);
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d6';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
BEGIN
  BEGIN
    PERFORM accept_invite(current_setting('verify.join_flow_token'));
    RAISE EXCEPTION 'SECURITY HOLE: a second, different person accepted an already-consumed invite';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invalid or expired%' THEN
      RAISE NOTICE 'PASS: a consumed invite cannot be replayed by someone else (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Hash-mismatch / unknown token: invite_preview reveals nothing, accept fails.
set request.jwt.claim.sub = '';
set role anon;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM invite_preview('not-a-real-token');
  ASSERT n = 0, format('FAIL: an unknown token must preview nothing, saw %s rows', n);
END $$;
reset role;

insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000d7', 'someone@example.com');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d7';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
BEGIN
  BEGIN
    PERFORM accept_invite('not-a-real-token');
    RAISE EXCEPTION 'SECURITY HOLE: accept_invite succeeded on an unknown token';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invalid or expired%' THEN
      RAISE NOTICE 'PASS: accept_invite() rejects an unknown/hash-mismatch token (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Revoked invite cannot be accepted.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
DO $$
DECLARE tok text;
BEGIN
  tok := create_invite('volunteer', 'Revoke Me');
  PERFORM set_config('verify.revoke_token', tok, false);
END $$;
reset role;

-- invites has RLS enabled with zero policies (every access path is a
-- SECURITY DEFINER RPC) — a raw select against it while role=authenticated
-- is still active sees zero rows, same as any other client. Look its id up
-- as the superuser instead, same pattern as VOL1_TOKEN/VOIDROW_ID elsewhere
-- in this script.
DO $$
DECLARE iid uuid;
BEGIN
  SELECT id INTO iid FROM invites
   WHERE token_hash = encode(extensions.digest(current_setting('verify.revoke_token'), 'sha256'), 'hex');
  PERFORM set_config('verify.revoke_invite_id', iid::text, false);
END $$;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
select revoke_invite(current_setting('verify.revoke_invite_id')::uuid);
reset role;

insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000d8', 'revoked-target@example.com');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d8';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
BEGIN
  BEGIN
    PERFORM accept_invite(current_setting('verify.revoke_token'));
    RAISE EXCEPTION 'SECURITY HOLE: a revoked invite was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invalid or expired%' THEN
      RAISE NOTICE 'PASS: a revoked invite cannot be accepted (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Expired invite cannot be accepted (backdate expires_at directly).
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
DO $$
DECLARE tok text;
BEGIN
  tok := create_invite('volunteer', 'Expire Me');
  PERFORM set_config('verify.expired_token', tok, false);
END $$;
reset role;
update invites set expires_at = now() - interval '1 minute'
 where token_hash = encode(extensions.digest(current_setting('verify.expired_token'), 'sha256'), 'hex');

insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000d9', 'expired-target@example.com');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d9';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
BEGIN
  BEGIN
    PERFORM accept_invite(current_setting('verify.expired_token'));
    RAISE EXCEPTION 'SECURITY HOLE: an expired invite was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%expired%' THEN
      RAISE NOTICE 'PASS: an expired invite cannot be accepted (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;
SQL

echo "== assertion: revoke_invite/resend_invite/list_pending_invites — tenant scoping + anon exposure =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Mandal two's admin must not be able to revoke/resend/see mandal one's invites.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
DO $$
DECLARE tok text;
BEGIN
  tok := create_invite('volunteer', 'Tenant Isolation Target');
  PERFORM set_config('verify.tenant_invite_token', tok, false);
END $$;
reset role;

-- Same RLS reason as the revoke_invite setup above: invites has no policies
-- of its own, so look its id up as the superuser, not while
-- role=authenticated is still active.
DO $$
DECLARE iid uuid;
BEGIN
  SELECT id INTO iid FROM invites
   WHERE token_hash = encode(extensions.digest(current_setting('verify.tenant_invite_token'), 'sha256'), 'hex');
  PERFORM set_config('verify.tenant_invite_id', iid::text, false);
END $$;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin
DO $$
BEGIN
  BEGIN
    PERFORM revoke_invite(current_setting('verify.tenant_invite_id')::uuid);
    RAISE EXCEPTION 'SECURITY HOLE: mandal two revoked mandal one''s invite';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invite not found%' THEN
      RAISE NOTICE 'PASS: revoke_invite() is tenant-scoped (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM resend_invite(current_setting('verify.tenant_invite_id')::uuid);
    RAISE EXCEPTION 'SECURITY HOLE: mandal two resent mandal one''s invite';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invite not found%' THEN
      RAISE NOTICE 'PASS: resend_invite() is tenant-scoped (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM list_pending_invites() WHERE id = current_setting('verify.tenant_invite_id')::uuid),
    'FAIL: list_pending_invites() leaked another mandal''s invite';
END $$;
reset role;

-- Owner CAN revoke their own mandal's invite.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select revoke_invite(current_setting('verify.tenant_invite_id')::uuid);
reset role;
DO $$
BEGIN
  ASSERT (SELECT revoked_at FROM invites WHERE id = current_setting('verify.tenant_invite_id')::uuid) IS NOT NULL,
    'FAIL: owner could not revoke their own mandal''s invite';
  RAISE NOTICE 'PASS: owner can revoke an invite in their own mandal';
END $$;

-- list_pending_invites is not exposed to anon.
set request.jwt.claim.sub = '';
set role anon;
DO $$
BEGIN
  BEGIN
    PERFORM list_pending_invites();
    RAISE EXCEPTION 'SECURITY HOLE: anon called list_pending_invites()';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: list_pending_invites() has no anon grant (%)', SQLERRM;
  END;
END $$;
reset role;
SQL

echo "== assertion: set_member_role — owner only, volunteer<->admin only (role escalation blocked) =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
select set_member_role('00000000-0000-0000-0000-000000000002', 'admin'); -- promote seed volunteer 002
reset role;

DO $$
BEGIN
  ASSERT (SELECT role FROM users WHERE id = '00000000-0000-0000-0000-000000000002') = 'admin',
    'FAIL: owner could not promote a volunteer to admin';
END $$;

-- A non-owner (the plain admin from the create_invite test) cannot change roles.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d2';
DO $$
BEGIN
  BEGIN
    PERFORM set_member_role('00000000-0000-0000-0000-000000000002', 'volunteer');
    RAISE EXCEPTION 'SECURITY HOLE: a non-owner admin changed a member''s role';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%only the owner%' THEN
      RAISE NOTICE 'PASS: set_member_role() blocks a non-owner (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Demote 002 back to volunteer so it doesn't disturb any later assertion
-- in this file that still expects it to be a plain volunteer.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select set_member_role('00000000-0000-0000-0000-000000000002', 'volunteer');
reset role;
DO $$
BEGIN
  ASSERT (SELECT role FROM users WHERE id = '00000000-0000-0000-0000-000000000002') = 'volunteer',
    'FAIL: set_member_role() could not demote back to volunteer';
  RAISE NOTICE 'PASS: set_member_role() promotes/demotes volunteer<->admin, owner-gated';
END $$;
SQL

echo "== assertion: transfer_ownership — atomic swap, owner-only, target must be an active admin =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- A non-owner cannot transfer ownership to themself (escalation attempt).
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d2'; -- plain admin
DO $$
BEGIN
  BEGIN
    PERFORM transfer_ownership('00000000-0000-0000-0000-0000000000d2');
    RAISE EXCEPTION 'SECURITY HOLE: a non-owner admin transferred ownership to themself';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%only the owner%' THEN
      RAISE NOTICE 'PASS: transfer_ownership() blocks a non-owner caller (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Owner transfers to the plain admin (d2); the swap must be atomic.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select transfer_ownership('00000000-0000-0000-0000-0000000000d2');
reset role;

DO $$
BEGIN
  ASSERT (SELECT role FROM users WHERE id = '00000000-0000-0000-0000-0000000000d2') = 'owner',
    'FAIL: transfer_ownership() did not promote the target';
  ASSERT (SELECT role FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'admin',
    'FAIL: transfer_ownership() did not demote the old owner';
  ASSERT (SELECT count(*) FROM users WHERE mandal_id = '11111111-1111-1111-1111-000000000001' AND role = 'owner') = 1,
    'FAIL: mandal one must have exactly one owner after transfer';
  RAISE NOTICE 'PASS: transfer_ownership() swaps roles atomically, exactly one owner survives';
END $$;

-- Transfer back so later assertions relying on aaaaaaaa-...-001 being the
-- owner (there are none after this point in the file, but this keeps the
-- fixture state predictable for anyone re-running a slice of this script).
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000d2';
select transfer_ownership('00000000-0000-0000-0000-000000000001'); -- fails: 001 is now 'admin', not active admin? it IS admin+active, so this succeeds.
reset role;
SQL

echo "== assertion: deactivate_member/reactivate_member — sole-owner self-protection, admin scope limits =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Owner (back to aaaaaaaa-...-001 after the transfer-back above) cannot
-- deactivate themself while sole owner.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
DO $$
BEGIN
  BEGIN
    PERFORM deactivate_member('00000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'SECURITY HOLE: the sole owner deactivated themself';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%cannot deactivate themself%' THEN
      RAISE NOTICE 'PASS: the owner cannot deactivate themself (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- Owner CAN deactivate an admin.
select deactivate_member('00000000-0000-0000-0000-0000000000d2');
reset role;
DO $$
BEGIN
  ASSERT (SELECT active FROM users WHERE id = '00000000-0000-0000-0000-0000000000d2') = false,
    'FAIL: owner could not deactivate an admin';
END $$;

-- An admin cannot deactivate another admin (scope: volunteers only). Use a
-- fresh active admin for this check.
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000e1', 'scope-admin-1@example.com');
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000e2', 'scope-admin-2@example.com');
insert into users (id, mandal_id, name, role, email, auth_user_id, active) values
  ('00000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-000000000001',
   'Scope Admin One', 'admin', 'scope-admin-1@example.com', 'aaaaaaaa-0000-0000-0000-0000000000e1', true),
  ('00000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-000000000001',
   'Scope Admin Two', 'admin', 'scope-admin-2@example.com', 'aaaaaaaa-0000-0000-0000-0000000000e2', true);

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000e1';
DO $$
BEGIN
  BEGIN
    PERFORM deactivate_member('00000000-0000-0000-0000-0000000000e2');
    RAISE EXCEPTION 'SECURITY HOLE: an admin deactivated another admin';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%only deactivate a volunteer%' THEN
      RAISE NOTICE 'PASS: an admin cannot deactivate another admin (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;

  -- ...but CAN deactivate/reactivate a volunteer.
  PERFORM deactivate_member('00000000-0000-0000-0000-000000000002'); -- seed volunteer, back to 'volunteer' from the prior test
END $$;
reset role;
DO $$
BEGIN
  ASSERT (SELECT active FROM users WHERE id = '00000000-0000-0000-0000-000000000002') = false,
    'FAIL: an admin could not deactivate a volunteer';
END $$;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000e1';
select reactivate_member('00000000-0000-0000-0000-000000000002');
reset role;
DO $$
BEGIN
  ASSERT (SELECT active FROM users WHERE id = '00000000-0000-0000-0000-000000000002') = true,
    'FAIL: an admin could not reactivate a volunteer';
  RAISE NOTICE 'PASS: deactivate_member/reactivate_member respect owner-vs-admin scope, and sole-owner self-protection';
END $$;

-- Clean up this task's throwaway fixtures so later count-based assertions
-- (if this section is ever reordered before them) aren't affected.
delete from users where id in (
  '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2'
);
SQL

echo "== all assertions passed =="
