# Architecture v5 — Identity, Membership & Onboarding (2026-07-19)

The spec for making auth production-grade. Replaces the anonymous-session volunteer model and the split admins/volunteers screens with one coherent system: **real identity for everyone, one membership model with three roles, one Manage Members surface, and an onboarding flow that never forces mandal creation.**

## Why the current model must go (grounded in code)

- Volunteers ride **anonymous Supabase sessions** bound by a one-time token (`InviteRedeem.tsx:53`, `redeem_invite`). Consequences: new phone/browser = locked out until an admin reissues; clearing storage = locked out; and the whole flow depends on `enable_anonymous_sign_ins` being on in prod — **this is almost certainly your current invite error**: local `config.toml:177` enables it with a comment warning prod must match; if prod has it off, every invite link dies at "could not set up session". (Second suspect: the two newest migrations not applied to prod — then `invite_preview` fails and links show "invalid invite".)
- Sign-up forces a fork but "I was invited" is a **dead-end screen** (`Signup.tsx:122-139`) — an invited person who signed in normally has nowhere to go.
- Admins and volunteers are managed on **two different screens with two different mechanics** (volunteers get links, admins get told to go request a magic link themselves — `admins.tsx` generates no link at all, which reads as broken).
- `users.email` is globally unique — one person can never belong to two mandals, and the creator has no distinguished role: any admin can manage any admin.

## Target model

### Identity: one login for everyone
Every human — owner, admin, volunteer — authenticates the same way: **Google OAuth or email magic link** (both already wired in `AdminLogin.tsx`). No passwords, no OTP-SMS costs, no anonymous sessions. This single change solves: multi-device login, lost phones, "does the volunteer click the link every time?" (no — the invite link is used **once to join**; after that they just open the app and are signed in, or sign in with the same Google/email from any device).

### Membership: `members` + `invites`

```sql
-- users table evolves into per-mandal membership (keep the table name `users`
-- to avoid a disruptive rename; conceptually it is now "members")
users (
  id uuid pk,
  mandal_id uuid not null → mandals,
  auth_user_id uuid → auth.users,      -- null only while invited
  role text check (role in ('owner','admin','volunteer')),
  name text not null,
  email text,                           -- contact + invite matching
  phone text,                           -- E.164
  active boolean default true,
  created_at,
  unique (mandal_id, auth_user_id),     -- one membership per person per mandal
  unique (id, mandal_id)                -- keep (composite FKs depend on it)
)
-- DROP the global unique(email); replace with unique(mandal_id, email).
-- Exactly one owner per mandal: unique partial index on (mandal_id) where role='owner'.

invites (                               -- invites leave the users row
  id uuid pk,
  mandal_id uuid not null → mandals,
  role text check (role in ('admin','volunteer')),   -- owners are never invited
  name text not null,
  email text,            -- optional; when set, only that email may accept
  phone text,
  token_hash text not null unique,      -- sha256 of the link token; raw token never stored
  invited_by uuid not null,             -- member id
  expires_at timestamptz not null default now() + interval '7 days',
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at
)
```

Why a separate `invites` table: invited-but-not-joined people stop being half-initialized `users` rows; tokens are hashed (a DB leak can't mint sessions); invites get expiry, revocation, resend, and an audit trail (`invited_by`); and role is part of the invite so **admins and volunteers are invited through the identical flow**.

### RPCs (all SECURITY DEFINER, `search_path` pinned, harness-tested)
- `create_invite(role, name, email?, phone?) → raw_token` — owner can invite admin+volunteer; admin can invite volunteer only. Returns the raw token once; client builds `/join/<token>`.
- `invite_preview(token) → (mandal_name, role, invitee_name)` — anon-callable, hash-matched, live invites only (evolves the existing one).
- `accept_invite(token)` — requires a **real** authenticated session (rejects anonymous — inverse of today's check). Validates live/unexpired/unrevoked + email restriction if set; creates the membership bound to `auth.uid()`; marks consumed. Idempotent if the same person re-opens the link (returns their membership).
- `revoke_invite(id)`, `resend` = revoke + create (new token, old link dies).
- `set_member_role(member_id, role)` — owner only; volunteer↔admin only (ownership moves via `transfer_ownership`).
- `transfer_ownership(member_id)` — owner only, target must be an active admin; swaps roles atomically.
- `deactivate_member(member_id)` / `reactivate_member(member_id)` — owner: anyone (except self while sole owner); admin: volunteers only. Deactivation keeps working instantly because the identity helpers already gate on `active`.
- `create_mandal(...)` — unchanged except the creator's row gets `role='owner'`.

### Permission matrix (enforced in RLS/RPCs, mirrored in UI)

| Capability | Owner | Admin | Volunteer |
|---|---|---|---|
| Collect donations, own cash/expenses/handover | ✓ | ✓ | ✓ |
| Dashboard, all collections, donors, expenses, handovers | ✓ | ✓ | — |
| Transparency publish/visibility | ✓ | ✓ | — |
| Branding settings (logo, signature, contacts, city) | ✓ | ✓ | — |
| Invite/manage volunteers | ✓ | ✓ | — |
| Invite/manage admins, change roles | ✓ | — | — |
| Danger zone (purge history), transfer ownership, delete mandal | ✓ | — | — |

DB changes for the matrix: `is_admin()` stays true for owner+admin (one definition change: `role in ('owner','admin')`); new `is_owner()`; owner-only RPCs check it; `purge_donations` moves to owner-only. Existing RLS policies keep working untouched because they're written against `is_admin()`.

### One surface: **Manage Members** (`/admin/members`)
Replaces `/admin/volunteers` + `/admin/admins`. One list, three sections or filter chips (Owner · Admins · Volunteers):
- Row: avatar initial, name, role badge, status pill (Invited — with expiry countdown / Active / Deactivated), contact icons (tel/wa).
- Actions per viewer role (matrix above): **Invite member** (sheet: name, role picker limited to what you may grant, optional email "locks the invite to this Google/email", phone) → produces the join link with copy + WhatsApp share buttons; per-row: copy/resend invite, revoke, change role (owner), deactivate/reactivate, cash-in-hand shortcut for volunteers.
- The volunteer-specific bits already built (reissue → becomes resend; deactivate) carry over.

## The flows (end to end)

**First-time visitor** → Landing → "Get started" → **one auth screen** (Google / email link — same for everyone) → signed in, no membership → **Welcome screen** (replaces forced signup):
> "Namaste <name>! You're signed in as <email>."
> ① **Create a new mandal** → mandal form → becomes **owner** → /admin.
> ② **Join your mandal** → "Open the invite link your mandal shared on WhatsApp. No invite? Ask your president/admin to add you in Manage Members." (+ paste-a-link box that just navigates to it).
No dead ends: the invited screen now has an actual action, and nobody is pushed into creating a mandal.

**Inviting (admin or volunteer, same flow)** → Manage Members → Invite → share `/join/<token>` on WhatsApp → invitee opens it → sees "**<Mandal>** invites you as **<role>**, <name>" → taps "Continue with Google" (or email) → `accept_invite` → lands on their home (/admin or /collect). If they were already signed in, it's two taps total. The link is dead afterwards (single-use), and idempotent for the member themself.

**Daily volunteer use** → open the PWA (installed on their phone) → session persists → /collect. New phone / other browser / cleared storage → /login → same Google account or magic link → straight back in. **No invite link needed ever again. No admin involvement.**

**Lost/stolen phone** → volunteer signs in on the new device (self-serve). If the phone itself is a risk, owner/admin deactivates the member (instant, because helpers gate on `active`), then reactivates after the volunteer secures their account.

**Offboarding** → deactivate (history and cash-in-hand attribution stay intact — never delete members with financial rows). **Role change** → owner flips volunteer↔admin in place. **Succession** → transfer ownership to an admin.

## Migration plan (phased, no lockouts)

1. **Hotfix now (independent of v5):** enable anonymous sign-ins on the prod Supabase project + `supabase db push` the pending migrations — this un-breaks today's invites while v5 is built.
2. **Schema migration:** add `'owner'` to role check; backfill: earliest active admin per mandal (the creator — `create_mandal`'s row) becomes owner. Create `invites`; drop global `unique(email)` → `unique(mandal_id, email)`; partial unique owner index.
3. **New RPCs + RLS deltas + harness assertions** (role escalation attempts, cross-tenant invites, expired/revoked/hash-mismatch tokens, sole-owner protection, anonymous accept rejected).
4. **UI:** single auth screen; Welcome screen; `/join/:token` (replaces `/invite/:token`; old route redirects and still honors old-style `users.invite_token` links during the transition window); Manage Members replaces the two screens.
5. **Volunteer upgrade path (transition):** existing anon-session volunteers get a persistent, dismissible banner — "Secure your account: add Google/email so you can sign in from any phone" → Supabase supports converting an anonymous user to permanent (`linkIdentity` / `updateUser({email})`) — the membership row doesn't even change. Volunteers who are already locked out simply receive a fresh invite from Manage Members. After the festival (or when no anon sessions remain), remove `redeem_invite`/anonymous support and turn `enable_anonymous_sign_ins` back off — closing the abuse surface for good.
6. **Cleanup:** `users.invite_token` dropped once transition ends; admins.tsx/volunteers.tsx deleted.

## Definition of done
A brand-new volunteer: receives a WhatsApp link → 2 taps + Google → collecting donations; next day opens the app on any device and is in without help. A brand-new owner: signs in → creates mandal → invites an admin and a volunteer from one screen in under a minute. No anonymous sessions in prod, no dead-end screens, one owner per mandal enforced by the database, every new RPC covered by harness assertions, and the invite error you saw is structurally impossible (no config-dependent anonymous path remains).
