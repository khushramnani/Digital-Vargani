-- Same class of bug as 20260717130000, missed on a fifth column.
--
-- Before multi-tenancy, donations.receipt_no was:
--   receipt_no bigint not null unique default nextval('receipt_no_seq')
-- 20260717120000 dropped that default (the global sequence is gone; the
-- number now comes from mandals.next_receipt_no inside
-- enforce_insert_defaults). But dropping it left receipt_no as
-- not-null-with-no-default, which the type generator marks REQUIRED in the
-- Insert type — so createDonation() could not compile without sending a
-- receipt_no it must never choose. That's a regression against the pre-
-- multi-tenancy behaviour, where the column had a default and was optional.
--
-- 0 is a placeholder the insert trigger unconditionally overwrites (it
-- assigns new.receipt_no from the mandal's counter on every insert, whatever
-- the client sent). It is deliberately NOT a plausible receipt number: if
-- the trigger were ever disabled, the first insert would take 0 and the
-- second would collide on unique(mandal_id, receipt_no) — a loud failure
-- rather than silently duplicated receipt numbers.

alter table donations alter column receipt_no set default 0;
