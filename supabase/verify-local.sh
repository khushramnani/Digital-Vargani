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
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create role anon;
create role authenticated;
SQL

echo "== applying migration =="
"${PSQL[@]}" -d "$DB_NAME" -f "$MIGRATION_FILE"

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

echo "== all assertions passed =="
