-- v6 — Auth, signup & invites flow redesign. See
-- docs/superpowers/specs/2026-07-29-auth-onboarding-flow-design.md.
--
-- The shape of the change: an invite gains a second, human-typable half (a
-- 10-char code) so it can travel by voice/WhatsApp as well as by link; the
-- email lock becomes a match hint rather than a gate (possession of either
-- half is now proof); and a new my_pending_invites() lets someone who lost
-- both halves still be found by the email their admin typed. That last one
-- is not a nicety — it is the ONLY rescue path for a magic-link user, who
-- lands in a different browser than the one holding the invite stash.

-- ── Code alphabet + generation ───────────────────────────────────────────
-- 31 symbols, deliberately missing I L O 0 1: this string gets read aloud
-- over a phone call and copied off a WhatsApp message by people who are not
-- typing it into a password manager. 10 chars ≈ 49.5 bits — comparable to a
-- random password, and the code is additionally single-use, 7-day, and
-- revocable, which is what makes it safe to treat as bearer proof.
--
-- gen_random_bytes, not random(): this value authorizes a membership.
-- ponytail: `% 31` over a uniform byte is very slightly biased (8 of the 31
-- symbols appear 9/256 rather than 8/256) — costs ~0.02 bits per character
-- and does not matter at this size. Rejection-sample only if the code ever
-- shortens.
create or replace function gen_invite_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  bytes             bytea := extensions.gen_random_bytes(10);
  out_code          text := '';
  i                 int;
begin
  for i in 0..9 loop
    out_code := out_code || substr(alphabet, 1 + (get_byte(bytes, i) % 31), 1);
  end loop;
  return out_code;
end;
$$;

-- Someone will type `k7m29 xpq4r`, or paste it with the display dash still
-- in. Both ends normalize identically; this is the server end.
create or replace function normalize_invite_code(raw text) returns text
language sql immutable set search_path = public as $$
  select upper(regexp_replace(coalesce(raw, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

alter table invites add column code text;

-- Uniqueness only among LIVE invites. The predicate cannot reference now()
-- (not immutable, so not indexable), which is why expiry stays a
-- lookup-time check and only consumed/revoked appear here. A consumed code
-- may therefore be re-minted later — accept_invite's lookup below is
-- written to cope with that, deliberately.
create unique index invites_code_live_uniq on invites (code)
  where consumed_at is null and revoked_at is null;

-- Draws a code not currently held by a live invite. The partial index above
-- is the real guard; this is the polite path that avoids relying on an
-- exception for ordinary control flow. ponytail: check-then-insert, not an
-- insert/retry loop — a lost race raises unique_violation from the index,
-- which at 31^10 will not happen before the heat death of this mandal.
create or replace function next_invite_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  candidate text;
  attempt   int := 0;
begin
  loop
    candidate := gen_invite_code();
    exit when not exists (
      select 1 from invites
       where code = candidate and consumed_at is null and revoked_at is null
    );
    attempt := attempt + 1;
    if attempt > 20 then
      raise exception 'could not mint a unique invite code';
    end if;
  end loop;
  return candidate;
end;
$$;

-- ── Masking, for the pre-accept mismatch confirm ─────────────────────────
-- invite_preview is granted to anon (it has to be — it runs before any
-- session exists), so it must not hand the invited person's full address to
-- whoever holds the link. Masked is enough to read "sent to p***a@gmail.com,
-- you're signed in as rahul@gmail.com". Gating on `authenticated` instead
-- would buy nothing: anyone can make an account.
create or replace function mask_email(e text) returns text
language sql immutable set search_path = public as $$
  select case
    when e is null or position('@' in e) = 0 then null
    -- A 1-2 char local part would otherwise reveal itself twice over.
    when length(split_part(e, '@', 1)) <= 2
      then left(split_part(e, '@', 1), 1) || '***@' || split_part(e, '@', 2)
    else left(split_part(e, '@', 1), 1) || '***' || right(split_part(e, '@', 1), 1)
         || '@' || split_part(e, '@', 2)
  end
$$;

-- ── Backfill ─────────────────────────────────────────────────────────────
-- Emails first: my_pending_invites() matches on lower(email), so any row
-- stored with the admin's original capitalisation would silently never
-- match. Only invites — users.email is left alone, since nothing looks it
-- up case-insensitively and rewriting it risks users_mandal_email_key.
update invites set email = lower(btrim(email))
 where email is not null and email <> lower(btrim(email));

-- Then codes, for invites that are still live. Consumed/revoked rows stay
-- NULL: they can never be redeemed again, and NULLs don't collide in the
-- partial unique index.
do $$
declare
  r record;
begin
  for r in select id from invites
            where code is null and consumed_at is null and revoked_at is null loop
    update invites set code = next_invite_code() where id = r.id;
  end loop;
end $$;

-- ── create_invite: email required; returns both halves ───────────────────
-- Return type changes text -> table, so drop + create (create-or-replace
-- cannot change a return type). Grants are re-issued below because the drop
-- takes them with it.
drop function create_invite(text, text, text, text);

create function create_invite(role text, name text, email text default null, phone text default null)
returns table (token text, code text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  raw_token text;
  new_code  text;
begin
  if not is_admin() then
    raise exception 'only an owner or admin can invite a member';
  end if;
  if role not in ('admin', 'volunteer') then
    raise exception 'invalid invite role';
  end if;
  if role = 'admin' and not is_owner() then
    raise exception 'only the owner can invite an admin';
  end if;
  if nullif(btrim(name), '') is null then
    raise exception 'name is required';
  end if;
  -- New in v6: email is what makes "just sign in and we'll find your invite"
  -- work, which is the only rescue a magic-link invitee gets.
  if nullif(btrim(email), '') is null then
    raise exception 'an email address is required — it is how we recognise them when they sign in';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  new_code  := next_invite_code();

  insert into invites (mandal_id, role, name, email, phone, token_hash, code, invited_by)
  values (
    app_mandal_id(), create_invite.role, btrim(create_invite.name),
    lower(btrim(create_invite.email)), nullif(btrim(create_invite.phone), ''),
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    new_code,
    app_user_id()
  );

  return query select raw_token, new_code;
end;
$$;

revoke execute on function create_invite(text, text, text, text) from public;
grant execute on function create_invite(text, text, text, text) to authenticated;

-- ── resend_invite: same, mints a fresh code alongside the fresh token ─────
drop function resend_invite(uuid);

create function resend_invite(invite_id uuid)
returns table (token text, code text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  old       invites%rowtype;
  raw_token text;
  new_code  text;
begin
  if not is_admin() then
    raise exception 'only an owner or admin can resend an invite';
  end if;

  select * into old from invites where id = invite_id and mandal_id = app_mandal_id();
  if not found then
    raise exception 'invite not found';
  end if;
  if old.consumed_at is not null then
    raise exception 'this invite has already been accepted';
  end if;
  if old.role = 'admin' and not is_owner() then
    raise exception 'only the owner can resend an admin invite';
  end if;

  -- Revoke first: that frees the old row's code from the live partial index
  -- before the new row claims one, so a resend can legitimately re-draw the
  -- same code without a collision.
  update invites set revoked_at = coalesce(revoked_at, now()) where id = invite_id;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  new_code  := next_invite_code();

  insert into invites (mandal_id, role, name, email, phone, token_hash, code, invited_by)
  values (old.mandal_id, old.role, old.name, old.email, old.phone,
          encode(extensions.digest(raw_token, 'sha256'), 'hex'), new_code, app_user_id());

  return query select raw_token, new_code;
end;
$$;

revoke execute on function resend_invite(uuid) from public;
grant execute on function resend_invite(uuid) to authenticated;

-- ── invite_preview: resolves either half; names the masked invitee email ──
-- Return type changes, so drop + create.
drop function invite_preview(text);

create function invite_preview(token text)
returns table (mandal_name text, role text, invitee_name text,
               invitee_email_masked text, matches_caller_email boolean)
language sql stable security definer set search_path = public, auth, extensions as $$
  -- matches_caller_email is computed here rather than by comparing masks in
  -- the client: two different addresses can mask to the same string
  -- (priya@ and pooja@ both give p***a@), and a false "these match" would
  -- silently skip the confirm this exists to raise. For anon the subquery
  -- yields NULL, so the comparison is false and the client — which only
  -- reads this with a session — is unaffected.
  select m.name, i.role, i.name, mask_email(i.email),
         i.email is not distinct from
           (select lower(btrim(u.email)) from auth.users u where u.id = auth.uid())
  from invites i
  join mandals m on m.id = i.mandal_id
  where (
      i.token_hash = encode(extensions.digest(invite_preview.token, 'sha256'), 'hex')
      -- A 64-char hex token normalizes to a 64-char string and can never
      -- collide with a 10-char code, so both arms can be tried at once.
      or i.code = normalize_invite_code(invite_preview.token)
    )
    and i.consumed_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  limit 1
$$;

revoke execute on function invite_preview(text) from public;
grant execute on function invite_preview(text) to anon, authenticated;

-- ── my_pending_invites: the magic-link rescue path ───────────────────────
-- Named for what it does (lists) rather than "claim_invite_by_email" — it
-- deliberately does NOT claim. The client shows an interstitial for one
-- match and a picker for several, then calls accept_invite with the code,
-- so there is exactly one code path that creates a membership.
--
-- Returns the code, not a bare invite id, for that reason. Safe: every row
-- returned is addressed to the caller's own VERIFIED email, so they were
-- always entitled to hold this value.
create or replace function my_pending_invites()
returns table (code text, mandal_name text, role text, invitee_name text)
language sql stable security definer set search_path = public, auth as $$
  select i.code, m.name, i.role, i.name
  from invites i
  join mandals m on m.id = i.mandal_id
  where i.consumed_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and i.code is not null
    -- email_confirmed_at is the whole guard: an unverified address would
    -- let anyone claim an invite by typing someone else's email at signup.
    -- Google and magic-link both confirm, and this app has no password
    -- signup, so in practice this only ever excludes a broken state.
    and i.email = (
      select lower(btrim(u.email)) from auth.users u
       where u.id = auth.uid() and u.email_confirmed_at is not null
    )
  order by i.created_at desc
$$;

revoke execute on function my_pending_invites() from public;
grant execute on function my_pending_invites() to authenticated;

-- ── list_pending_invites: now carries the code, for Manage Members ───────
drop function list_pending_invites();

create function list_pending_invites()
returns table (id uuid, role text, name text, email text, phone text, code text,
               expires_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, role, name, email, phone, code, expires_at, created_at
  from invites
  where mandal_id = app_mandal_id()
    and is_admin()
    and consumed_at is null
    and revoked_at is null
    and expires_at > now()
  order by created_at desc
$$;

revoke execute on function list_pending_invites() from public;
grant execute on function list_pending_invites() to authenticated;

-- ── accept_invite: resolves either half; email is a hint, not a gate ─────
-- Signature unchanged (create-or-replace, grants preserved). The `token`
-- parameter now accepts a raw token OR a code — it cannot be renamed
-- without dropping the function, and the drop would be pure churn.
--
-- Everything inherited from 20260720150000 is deliberately untouched: the
-- FOR UPDATE replay lock, the idempotent already-a-member branch, and the
-- gate that stops a deactivated member self-reactivating with a stale
-- consumed token. Two things change: the email lock is gone (the approved
-- decision — possession of a link or code is proof, and the pre-accept
-- mismatch confirm now lives in the client, off invite_preview), and the
-- new users row records the email they ACTUALLY signed in with rather than
-- the one the admin typed, since those are now allowed to differ.
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

  select * into inv from invites
   where token_hash = encode(extensions.digest(accept_invite.token, 'sha256'), 'hex')
   for update;

  if not found then
    -- Code lookup is NOT filtered to live rows, on purpose. A live row wins
    -- the ordering; falling back to the newest dead one means a double-tap
    -- or refresh right after a successful join lands on the idempotent
    -- already-a-member branch below (a silent success) instead of telling
    -- someone who just joined that their code is invalid.
    select * into inv from invites
     where code = normalize_invite_code(accept_invite.token)
     order by (consumed_at is null and revoked_at is null) desc, created_at desc
     limit 1
     for update;
  end if;

  if not found then
    raise exception 'invalid or expired invite link';
  end if;

  select id into existing_member_id from users
   where mandal_id = inv.mandal_id and auth_user_id = auth.uid();

  if existing_member_id is not null then
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

  select lower(btrim(u.email)) into my_email from auth.users u where u.id = auth.uid();

  begin
    insert into users (mandal_id, auth_user_id, role, name, email, phone, active)
    values (inv.mandal_id, auth.uid(), inv.role, inv.name,
            coalesce(my_email, inv.email), inv.phone, true);
  exception when unique_violation then
    -- users_mandal_email_key. Reachable now that the joiner's own address
    -- goes in rather than the invited one: someone else in this mandal may
    -- already hold it. Raw constraint text would be unreadable here.
    raise exception 'another member of this mandal already uses %', coalesce(my_email, inv.email);
  end;

  update invites set consumed_at = now() where id = inv.id;
end;
$$;
