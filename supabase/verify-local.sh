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
MIGRATION_FILE="$SCRIPT_DIR/migrations/20260714111950_schema_and_rls.sql"
MIGRATION_FILE_2="$SCRIPT_DIR/migrations/20260714121305_add_users_email.sql"
MIGRATION_FILE_3="$SCRIPT_DIR/migrations/20260714124014_redeem_invite.sql"
MIGRATION_FILE_4="$SCRIPT_DIR/migrations/20260714131940_mandal_assets_storage.sql"
MIGRATION_FILE_5="$SCRIPT_DIR/migrations/20260714134206_donations_sms_sent.sql"
MIGRATION_FILE_6="$SCRIPT_DIR/migrations/20260714140000_donations_idempotency_key.sql"
MIGRATION_FILE_7="$SCRIPT_DIR/migrations/20260714150000_list_admins.sql"
MIGRATION_FILE_8="$SCRIPT_DIR/migrations/20260714160000_transparency_report.sql"
SEED_FILE="$SCRIPT_DIR/seed.sql"

PORT="${VERIFY_LOCAL_PORT:-55432}"
DB_NAME="vm_verify"
PGUSER="postgres"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vm-verify-pg.XXXXXX")"
LOG_FILE="$DATA_DIR/postgres.log"

# Fall back to the known scoop install location if the pg binaries aren't
# already on PATH.
PG_BIN_FALLBACK="/c/Users/khush/scoop/apps/postgresql/current/bin"
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
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create role anon;
create role authenticated;
SQL

echo "== applying migration =="
"${PSQL[@]}" -d "$DB_NAME" -f "$MIGRATION_FILE"

echo "== applying migration (add_users_email) =="
"${PSQL[@]}" -d "$DB_NAME" -f "$MIGRATION_FILE_2"

echo "== applying migration (redeem_invite) =="
"${PSQL[@]}" -d "$DB_NAME" -f "$MIGRATION_FILE_3"

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
SQL

echo "== applying migration (mandal_assets_storage) =="
"${PSQL[@]}" -d "$DB_NAME" -f "$MIGRATION_FILE_4"

echo "== applying migration (donations_sms_sent) =="
"${PSQL[@]}" -d "$DB_NAME" -f "$MIGRATION_FILE_5"

echo "== applying migration (donations_idempotency_key) =="
"${PSQL[@]}" -d "$DB_NAME" -f "$MIGRATION_FILE_6"

echo "== applying migration (list_admins) =="
"${PSQL[@]}" -d "$DB_NAME" -f "$MIGRATION_FILE_7"

echo "== applying migration (transparency_report) =="
"${PSQL[@]}" -d "$DB_NAME" -f "$MIGRATION_FILE_8"

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
insert into users (id, name, role, email, active) values
  ('00000000-0000-0000-0000-000000000099', 'Link Test Admin', 'admin', 'linktest-admin@example.com', true);

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
insert into users (id, name, role, invite_token, active) values
  ('00000000-0000-0000-0000-000000000098', 'Redeem Test Volunteer', 'volunteer', 'redeem-test-token', true);

insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-000000000098');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000098';
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

DO $$
BEGIN
  ASSERT (SELECT auth_user_id FROM users WHERE id = '00000000-0000-0000-0000-000000000098')
    = 'aaaaaaaa-0000-0000-0000-000000000098',
    'FAIL: rejected replay must not have changed the already-linked auth_user_id';
END $$;
SQL

echo "== backfilling auth_user_id + seeding test donations =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002');

update users set auth_user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-000000000001'; -- Admin Treasurer
update users set auth_user_id = 'aaaaaaaa-0000-0000-0000-000000000002'
  where id = '00000000-0000-0000-0000-000000000002'; -- Volunteer One

-- Superuser is the table owner and bypasses RLS; this is just test-data
-- setup, not itself an RLS assertion.
insert into donations (donor_name, amount_paise, mode, collected_by) values
  ('Vol1 Donor', 10000, 'cash', '00000000-0000-0000-0000-000000000002'),
  ('Vol2 Donor', 20000, 'cash', '00000000-0000-0000-0000-000000000003');
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

-- Sanity check the trigger isn't over-broad: voiding (an allowed edit) must
-- still succeed.
UPDATE donations SET voided = true, void_reason = 'verify-local test void'
  WHERE donor_name = 'Vol2 Donor';
DO $$
BEGIN
  ASSERT (SELECT voided FROM donations WHERE donor_name = 'Vol2 Donor') = true,
    'FAIL: voiding a donation (an allowed field) should still succeed';
END $$;
UPDATE donations SET voided = false, void_reason = null WHERE donor_name = 'Vol2 Donor';
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

  ASSERT (SELECT count(*) FROM donations WHERE receipt_no = dup_receipt_no) = 1,
    'FAIL: two donations ended up sharing the same receipt_no';
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
    -- is what's being exercised, not the trigger papering over it.
    ALTER TABLE donations DISABLE TRIGGER donations_enforce_insert;
    INSERT INTO donations (donor_name, amount_paise, mode, collected_by, receipt_no)
      VALUES ('Should Violate Unique', 100, 'cash', '00000000-0000-0000-0000-000000000001', dup_receipt_no);
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

insert into storage.objects (bucket_id, name) values ('mandal-assets', 'logo-test.png');

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM storage.objects WHERE name = 'logo-test.png') = 1,
    'FAIL: admin insert into mandal-assets storage.objects should have succeeded';
END $$;

update storage.objects set name = 'logo-test-renamed.png' where name = 'logo-test.png';

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM storage.objects WHERE name = 'logo-test-renamed.png') = 1,
    'FAIL: admin update of mandal-assets storage.objects should have succeeded';
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
    insert into storage.objects (bucket_id, name) values ('mandal-assets', 'should-be-rejected.png');
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
insert into users (id, name, role, email, active) values
  ('00000000-0000-0000-0000-000000000096', 'Inactive Admin', 'admin', 'inactive-admin@example.com', false);

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
-- Own isolated expense rows (a fresh category), so the category breakdown
-- assertion below has a known, exact expected row rather than depending on
-- whatever earlier assertions left behind.
insert into expenses (category, amount_paise, paid_by, paid_from) values
  ('Transparency Test', 12345, '00000000-0000-0000-0000-000000000001', 'cash');

-- enforce_insert_defaults (Task 2 migration) unconditionally forces
-- voided=false on INSERT regardless of what's sent — void via UPDATE
-- after the fact, same as every other voided-row fixture in this script.
insert into expenses (category, amount_paise, paid_by, paid_from) values
  ('Transparency Test', 99999999, '00000000-0000-0000-0000-000000000001', 'cash');
update expenses set voided = true, void_reason = 'test row, must be excluded',
    voided_by = '00000000-0000-0000-0000-000000000001', voided_at = now()
  where amount_paise = 99999999 and category = 'Transparency Test';

set role anon;
DO $$
DECLARE
  row_count int;
BEGIN
  SELECT count(*) INTO row_count FROM get_transparency_report();
  ASSERT row_count = 0, format('FAIL: unpublished report should return 0 rows to anon, saw %s', row_count);

  SELECT count(*) INTO row_count FROM get_transparency_categories();
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
  SELECT count(*) INTO row_count FROM get_transparency_report();
  ASSERT row_count = 1, format('FAIL: admin preview of the report should return 1 row even unpublished, saw %s', row_count);

  SELECT amount_paise INTO category_amount FROM get_transparency_categories() WHERE category = 'Transparency Test';
  ASSERT category_amount = 12345,
    format('FAIL: admin preview category total should be 12345 (voided row excluded), saw %s', category_amount);

  RAISE NOTICE 'PASS: admin preview bypasses the publish gate and excludes the voided expense from the category sum';
END $$;
SQL

echo "== assertion: Task 16 publishing (via the admin RLS update policy) makes the report visible to anon =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- Admin Treasurer
update mandal_config set transparency_published = true where id = true;
reset role;

set role anon;
DO $$
DECLARE
  row_count int;
  category_amount bigint;
BEGIN
  SELECT count(*) INTO row_count FROM get_transparency_report();
  ASSERT row_count = 1, format('FAIL: published report should return 1 row to anon, saw %s', row_count);

  SELECT amount_paise INTO category_amount FROM get_transparency_categories() WHERE category = 'Transparency Test';
  ASSERT category_amount = 12345,
    format('FAIL: published category total should be 12345 (voided row excluded), saw %s', category_amount);

  RAISE NOTICE 'PASS: after publishing, anon sees the aggregate report and excludes the voided expense from the category sum';
END $$;
reset role;
SQL

echo "== all assertions passed =="
