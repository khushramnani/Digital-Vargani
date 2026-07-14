-- Task 8: track whether a donation's receipt SMS was sent. `sms:` deep
-- links have no delivery confirmation — this can only ever record "the
-- volunteer's device was told to open the SMS composer," which fits the
-- app's existing trust-based philosophy (same spirit as trusting a
-- volunteer's payment-mode entry). Safe and additive: sms_sent_at is not
-- in forbid_financial_edit()'s guarded column list (Task 2's trigger only
-- blocks edits to donor_name, donor_phone, amount_paise, mode,
-- collected_by, receipt_no, public_token), so updating it isn't blocked.
-- No new RLS policy needed — the existing donations_volunteer_update /
-- donations_admin_update policies already permit updating a row a
-- volunteer collected or any row for admin.

alter table donations add column sms_sent_at timestamptz;
