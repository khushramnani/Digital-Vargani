-- PR #4 external review — security hardening. See
-- docs/architecture-v5-identity-membership.md and the review notes for
-- full context. Four independent fixes, kept in one migration because they
-- all land together as one remediation pass; order below matches the order
-- they were raised in review.

-- ── Blocker 1: drop dead direct-write RLS policies on users ─────────────
-- users_admin_insert/users_admin_update (from 20260717120000_multi_tenancy.sql)
-- let any admin/owner UPDATE or INSERT any column on any users row in their
-- own mandal, with no column restriction. Every legitimate membership
-- mutation now goes through a SECURITY DEFINER RPC (create_invite/
-- accept_invite/set_member_role/transfer_ownership/deactivate_member/
-- reactivate_member), all of which bypass RLS entirely by design (same as
-- create_mandal already did) — these two policies are pure dead attack
-- surface. A plain admin could otherwise demote the owner and promote
-- themself with two raw supabase-js calls, bypassing every authorization
-- guard those RPCs enforce. users_admin_select (read) is unaffected and
-- stays — reading member lists is still needed and safe.
drop policy users_admin_insert on users;
drop policy users_admin_update on users;

-- ── Item 5: accept_invite — replay race, stuck-live invite, stuck-deactivation ─
-- Full republish (create or replace), not a targeted edit: migrations are
-- append-only, so the previous version in 20260720130000 stays as history
-- and this one wins. Grants set in that earlier migration are untouched by
-- create-or-replace (same reasoning create_mandal already relies on).
create or replace function accept_invite(token text) returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  inv                invites%rowtype;
  my_email           text;
  existing_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'invite links are accepted with a real Google or email account';
  end if;

  -- FOR UPDATE: a second caller racing the same still-live token blocks here
  -- until this transaction commits, then re-reads the now-consumed row and
  -- is correctly rejected below — closes a replay race where two different
  -- people could both accept one single-use token.
  select * into inv from invites
   where token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
   for update;
  if not found then
    raise exception 'invalid or expired invite link';
  end if;

  select id into existing_member_id from users
   where mandal_id = inv.mandal_id and auth_user_id = auth.uid();

  if existing_member_id is not null then
    -- Idempotent: the same person re-opening a link they already used (or
    -- being re-invited after deactivation — only an owner/admin can mint an
    -- invite, so a fresh one for an already-deactivated person is implicit
    -- authorization to restore them) lands back on their membership instead
    -- of an error. Mark the invite consumed here too (it previously wasn't,
    -- which left an unlocked, still-live invite replayable by a stranger
    -- later, since an open/no-email-lock invite has nothing else stopping
    -- someone else from using the same link before it naturally expired).
    --
    -- Reactivation is gated on the invite STILL being live (not revoked,
    -- not already consumed, not expired): the invite lookup above has no
    -- status filter, so `inv` can be someone's own long-consumed original
    -- invite. Without this gate, a deactivated member could self-reactivate
    -- by replaying that stale token — a new bypass of deactivate_member's
    -- offboarding control this fix would otherwise introduce.
    update users set active = true
     where id = existing_member_id and not active
       and inv.revoked_at is null and inv.consumed_at is null and inv.expires_at > now();
    update invites set consumed_at = coalesce(consumed_at, now()) where id = inv.id;
    return;
  end if;

  if inv.revoked_at is not null or inv.consumed_at is not null then
    raise exception 'invalid or expired invite link';
  end if;
  if inv.expires_at <= now() then
    raise exception 'this invite link has expired';
  end if;

  if inv.email is not null then
    select email into my_email from auth.users where id = auth.uid();
    if my_email is null or lower(btrim(my_email)) <> lower(btrim(inv.email)) then
      raise exception 'this invite is locked to a different email address';
    end if;
  end if;

  insert into users (mandal_id, auth_user_id, role, name, email, phone, active)
  values (inv.mandal_id, auth.uid(), inv.role, inv.name, inv.email, inv.phone, true);

  update invites set consumed_at = now() where id = inv.id;
end;
$$;

-- ── Item 7: invites.invited_by had no FK at all ───────────────────────────
-- Every other actor-style column in this schema (collected_by/paid_by/
-- volunteer_id/received_by) is composite-FK'd to users(id, mandal_id) to
-- prevent a cross-mandal actor reference (see 20260718130000_composite_
-- actor_fks.sql for why). invited_by is always stamped server-side from
-- app_user_id() inside create_invite/resend_invite, always in the caller's
-- own mandal, so the same composite pattern applies cleanly.
alter table invites add constraint invites_invited_by_fkey
  foreign key (invited_by, mandal_id) references users(id, mandal_id);

-- ── Item 8: owner backfill wrongly promoted the demo mandal's seed admin ──
-- Corrective follow-up to 20260720120000's owner backfill, which promoted
-- ANY active admin regardless of auth_user_id — including the demo
-- mandal's intentionally un-authenticatable "Demo Treasurer" row
-- (20260717150000_demo_mandal.sql). Harmless in practice (nobody can ever
-- log in as the demo mandal), but a real inconsistency worth correcting.
-- Safe and narrowly scoped: create_mandal/accept_invite always set
-- auth_user_id from a real session, so no genuinely-new owner row can ever
-- match this condition — only this one historical backfill artifact can.
update users set role = 'admin'
 where role = 'owner' and auth_user_id is null;
