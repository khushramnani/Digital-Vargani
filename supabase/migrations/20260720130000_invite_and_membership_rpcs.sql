-- v5 — Identity, Membership & Onboarding: invite + membership RPCs. See
-- docs/architecture-v5-identity-membership.md and the plan's "Decisions"
-- section for why create_mandal's old guards are gone, not ported.

-- ── create_mandal: creator becomes owner; multi-mandal membership allowed ─
-- Same signature as the v4 migration, so create-or-replace (no drop). The
-- "already has a mandal" / "email already invited elsewhere" guards are
-- gone — auth_user_id and email are now unique only WITHIN a mandal
-- (Task 1), which is what actually prevents a duplicate membership in the
-- SAME mandal; belonging to more than one mandal is now correct behaviour.
create or replace function create_mandal(
  mandal_name    text,
  admin_name     text,
  slug_hint      text default null,
  mandal_state   text default null,
  mandal_address text default null,
  mandal_city    text default null
)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  my_email  text;
  base      text;
  candidate text;
  sfx       text;
  suffix    int := 1;
  new_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'anonymous sessions cannot create a mandal';
  end if;

  select email into my_email from auth.users where id = auth.uid();
  if my_email is null then
    raise exception 'account has no verified email';
  end if;

  base := coalesce(
    nullif(slugify(slug_hint), ''),
    nullif(slugify(mandal_name), ''),
    'mandal'
  );

  if length(base) < 2 then
    base := base || '-mandal';
  end if;

  base := rtrim(left(base, 40), '-');
  candidate := base;

  loop
    begin
      insert into mandals (name, slug, state, address, city, president_name)
        values (
          mandal_name,
          candidate,
          nullif(btrim(mandal_state), ''),
          nullif(btrim(mandal_address), ''),
          nullif(btrim(mandal_city), ''),
          nullif(btrim(admin_name), '')
        )
      returning id into new_id;
      exit;
    exception when unique_violation then
      suffix := suffix + 1;
      if suffix > 50 then
        sfx := '-' || substr(gen_random_uuid()::text, 1, 6);
      else
        sfx := '-' || suffix;
      end if;
      candidate := rtrim(left(base, 40 - length(sfx)), '-') || sfx;
    end;
  end loop;

  insert into users (mandal_id, name, email, role, auth_user_id, active)
  values (new_id, admin_name, my_email, 'owner', auth.uid(), true);

  return new_id;
end;
$$;

-- ── Old link-on-first-use RPCs: unreachable from any UI after this ───────
drop function link_admin_account();
drop function redeem_invite(text);
drop function reissue_invite(uuid);
drop function invite_preview(text); -- old 2-column signature; recreated below

-- ── create_invite: owner invites admin+volunteer; admin invites volunteer ─
create or replace function create_invite(role text, name text, email text default null, phone text default null)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  raw_token text;
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

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into invites (mandal_id, role, name, email, phone, token_hash, invited_by)
  values (
    app_mandal_id(), role, btrim(name),
    nullif(btrim(email), ''), nullif(btrim(phone), ''),
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    app_user_id()
  );

  return raw_token;
end;
$$;

revoke execute on function create_invite(text, text, text, text) from public;
grant execute on function create_invite(text, text, text, text) to authenticated;

-- ── invite_preview: names the mandal + role BEFORE any session exists ────
create or replace function invite_preview(token text)
returns table (mandal_name text, role text, invitee_name text)
language sql stable security definer set search_path = public, extensions as $$
  select m.name, i.role, i.name
  from invites i
  join mandals m on m.id = i.mandal_id
  where i.token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
    and i.consumed_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  limit 1
$$;

revoke execute on function invite_preview(text) from public;
grant execute on function invite_preview(text) to anon, authenticated;

-- ── accept_invite: a real (never anonymous) session joins the mandal ─────
create or replace function accept_invite(token text) returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  inv      invites%rowtype;
  my_email text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'invite links are accepted with a real Google or email account';
  end if;

  select * into inv from invites where token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
  if not found then
    raise exception 'invalid or expired invite link';
  end if;

  -- Idempotent: the same person re-opening a link they already used lands
  -- back on their existing membership instead of an error.
  if exists (select 1 from users where mandal_id = inv.mandal_id and auth_user_id = auth.uid()) then
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

revoke execute on function accept_invite(text) from public;
grant execute on function accept_invite(text) to authenticated;

-- ── revoke_invite / resend_invite ─────────────────────────────────────────
create or replace function revoke_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv_role text;
begin
  if not is_admin() then
    raise exception 'only an owner or admin can revoke an invite';
  end if;

  select role into inv_role from invites
   where id = invite_id and mandal_id = app_mandal_id()
     and consumed_at is null and revoked_at is null;
  if not found then
    raise exception 'invite not found';
  end if;
  if inv_role = 'admin' and not is_owner() then
    raise exception 'only the owner can revoke an admin invite';
  end if;

  update invites set revoked_at = now() where id = invite_id;
end;
$$;

revoke execute on function revoke_invite(uuid) from public;
grant execute on function revoke_invite(uuid) to authenticated;

create or replace function resend_invite(invite_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  old       invites%rowtype;
  raw_token text;
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

  update invites set revoked_at = coalesce(revoked_at, now()) where id = invite_id;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into invites (mandal_id, role, name, email, phone, token_hash, invited_by)
  values (old.mandal_id, old.role, old.name, old.email, old.phone,
          encode(extensions.digest(raw_token, 'sha256'), 'hex'), app_user_id());

  return raw_token;
end;
$$;

revoke execute on function resend_invite(uuid) from public;
grant execute on function resend_invite(uuid) to authenticated;

-- ── list_pending_invites: the "Invited" rows in Manage Members ───────────
create or replace function list_pending_invites()
returns table (id uuid, role text, name text, email text, phone text, expires_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, role, name, email, phone, expires_at, created_at
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

-- ── set_member_role: owner only, volunteer<->admin only ──────────────────
create or replace function set_member_role(member_id uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then
    raise exception 'only the owner can change a member''s role';
  end if;
  if new_role not in ('admin', 'volunteer') then
    raise exception 'invalid role';
  end if;

  update users set role = new_role
   where id = member_id and mandal_id = app_mandal_id() and role in ('admin', 'volunteer');
  if not found then
    raise exception 'member not found, or is the owner';
  end if;
end;
$$;

revoke execute on function set_member_role(uuid, text) from public;
grant execute on function set_member_role(uuid, text) to authenticated;

-- ── transfer_ownership: owner only, target must be an active admin ───────
create or replace function transfer_ownership(member_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_user_id();
  m  uuid := app_mandal_id();
begin
  if not is_owner() then
    raise exception 'only the owner can transfer ownership';
  end if;
  if not exists (select 1 from users where id = member_id and mandal_id = m and role = 'admin' and active) then
    raise exception 'ownership can only be transferred to an active admin in your mandal';
  end if;

  -- Demote-then-promote, in that order: users_one_owner_per_mandal allows
  -- exactly one 'owner' row per mandal at any point this transaction is
  -- observable from outside, so the old owner must vacate the slot first.
  update users set role = 'admin' where id = me and mandal_id = m;
  update users set role = 'owner' where id = member_id and mandal_id = m;
end;
$$;

revoke execute on function transfer_ownership(uuid) from public;
grant execute on function transfer_ownership(uuid) to authenticated;

-- ── deactivate_member / reactivate_member ─────────────────────────────────
create or replace function deactivate_member(member_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  target users%rowtype;
begin
  select * into target from users where id = member_id and mandal_id = app_mandal_id();
  if not found then
    raise exception 'member not found';
  end if;

  if is_owner() then
    if target.id = app_user_id() then
      raise exception 'the owner cannot deactivate themself — transfer ownership first';
    end if;
  elsif is_admin() then
    if target.role <> 'volunteer' then
      raise exception 'an admin can only deactivate a volunteer';
    end if;
  else
    raise exception 'only an owner or admin can deactivate a member';
  end if;

  update users set active = false where id = member_id and mandal_id = app_mandal_id();
end;
$$;

revoke execute on function deactivate_member(uuid) from public;
grant execute on function deactivate_member(uuid) to authenticated;

create or replace function reactivate_member(member_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  target users%rowtype;
begin
  select * into target from users where id = member_id and mandal_id = app_mandal_id();
  if not found then
    raise exception 'member not found';
  end if;

  if is_owner() then
    null;
  elsif is_admin() then
    if target.role <> 'volunteer' then
      raise exception 'an admin can only reactivate a volunteer';
    end if;
  else
    raise exception 'only an owner or admin can reactivate a member';
  end if;

  update users set active = true where id = member_id and mandal_id = app_mandal_id();
end;
$$;

revoke execute on function reactivate_member(uuid) from public;
grant execute on function reactivate_member(uuid) to authenticated;
