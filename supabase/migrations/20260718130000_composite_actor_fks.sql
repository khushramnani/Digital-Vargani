-- Audit 2026-07-18 #3: the actor foreign keys (collected_by / paid_by /
-- volunteer_id / received_by) referenced users(id) with no check that the
-- actor belongs to the ROW's mandal. Combined with the device-scoped Dexie
-- outbox, a shared phone could sync mandal A's queued donation into mandal
-- B's books — counted in B's totals, invisible in every cash-in-hand view.
--
-- Make each actor FK composite: (actor, mandal_id) must be a real user in
-- THAT mandal. A row can no longer name an actor from another tenant.
--
-- Requires a unique key on the referenced pair first. users.id is already
-- the primary key, so (id, mandal_id) is trivially unique; the extra
-- constraint just makes it referenceable by a composite FK.

alter table users add constraint users_id_mandal_key unique (id, mandal_id);

-- Same constraint NAMES as before (the generated types reference them), only
-- the referenced columns change from (id) to (id, mandal_id).
alter table donations drop constraint donations_collected_by_fkey;
alter table donations add constraint donations_collected_by_fkey
  foreign key (collected_by, mandal_id) references users(id, mandal_id);

alter table expenses drop constraint expenses_paid_by_fkey;
alter table expenses add constraint expenses_paid_by_fkey
  foreign key (paid_by, mandal_id) references users(id, mandal_id);

alter table handovers drop constraint handovers_volunteer_id_fkey;
alter table handovers add constraint handovers_volunteer_id_fkey
  foreign key (volunteer_id, mandal_id) references users(id, mandal_id);

alter table handovers drop constraint handovers_received_by_fkey;
alter table handovers add constraint handovers_received_by_fkey
  foreign key (received_by, mandal_id) references users(id, mandal_id);

-- voided_by is deliberately left referencing users(id): it is stamped
-- server-side by void_row()/clear_donation_history() from the caller's own
-- session (always same-mandal), never chosen by the client.
