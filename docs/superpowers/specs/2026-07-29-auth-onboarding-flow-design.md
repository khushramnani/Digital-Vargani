# Auth, Signup & Invites — flow redesign (v6)

Date: 2026-07-29
Supersedes the onboarding half of `docs/architecture-v5-identity-membership.md`.
Source plan: `user-flow-plan.md` (v2), with two corrections applied — see §0.

## Problem

Four defects in one flow.

1. **The invite link loses its token.** `/join/:token` starts a Google/magic-link
   round trip with `redirectTo=/join/<token>`. If that URL isn't in the project's
   Auth → Redirect URLs allowlist, Supabase silently falls back to Site URL (`/`),
   so the invitee lands on the landing page with a valid session and no token.
   Everything downstream already works — `accept_invite` auto-runs once a real
   session exists — it just never gets the token back.
2. **The recovery path is a paste-the-URL demand.** Having lost the token, the
   invitee must find `/signup`, pick "I was invited", and paste a 64-char link.
3. **The landing page's Start free scrolls to the footer.** `href="#cta"` is an
   in-page anchor; the footer CTA then links to `/signup`, which requires a
   session, which bounces to `/login`. Three hops to a login screen.
4. **`/signup` is post-auth only.** The create-vs-join fork happens *after* you
   have an identity, so there is no public sign-up door at all.

## §0 — Corrections applied to the source plan

Both were approved before writing this spec.

**C1. `last_mandal_id` is cut.** The plan's resolver step 2 routed multi-membership
users by a `localStorage.last_mandal_id`. The server does not know about that:
`app_mandal_id()` / `app_user_id()` / `app_user_role()` (migration `20260720130000`)
are hard-coded to the newest-joined active membership, and every RLS policy scopes
through them. A client that picks mandal B while the server resolves A would show
A's ledger under B's name and write new donations into A. That migration's own
comment states the three functions were made deterministic precisely so "server and
client always agree on which mandal a session acts in". Since the mandal switcher is
explicitly deferred, `last_mandal_id` is machinery for an unbuilt feature that costs
correctness today. **The client routes to the same newest-joined membership the
server uses.** Real per-session mandal selection needs a server-side session claim
and belongs to the switcher follow-up.

**C2. The email-mismatch confirm moves to `invite_preview`.** The plan had
`accept_invite` return the invite's email "so the client can show a mismatch
confirm" — but `accept_invite` performs the join, so by then the membership row
exists and the confirm is after the fact. The confirm hangs off `invite_preview`,
which already runs pre-session. `invite_preview` is granted to `anon`, so it returns
a **masked** address (`p***a@gmail.com`); gating on `authenticated` would buy nothing
because anyone can create an account.

## §1 — Three public doors

| Route          | Session required | What it is                                  |
|----------------|------------------|---------------------------------------------|
| `/login`       | no               | Sign in. Nothing else.                       |
| `/signup`      | **no** (today: yes) | Choice: Create a mandal / I was invited   |
| `/join/:token` | no               | The invite link. URL unchanged.              |
| `/continue`    | **new**          | Post-auth resolver. All resolution UI lives here. |

Landing page (`LandingPage.tsx`):

- Nav **Start free** → `<Link to="/signup">`. The `href="#cta"` anchor dies.
- Hamburger gets **Log in** + **Sign up** as real destinations (same two links the
  desktop nav has).
- Hero primary CTA → `/signup`. Footer CTA already points at `/signup`; unchanged.
- When a session exists, the nav's Log in / Sign up pair collapses to a single
  **Go to your mandal** → `/continue`. A signed-in user who lands on `/` today sees
  a pure marketing page with no way back in; this is also the last-resort catch for
  a lost invite stash.

## §2 — The post-auth resolver (`/continue`)

One route, one component, owning every post-auth decision and the UI for each. The
order is load-bearing and **every step defines its failure path**.

```
1. no session                     → /login
2. memberships := active memberships for this identity
3. stash present and < 7 days old?
     ├─ invite_preview(stashed token)
     │    ├─ resolves:
     │    │    ├─ memberships non-empty → SECOND-MANDAL CONFIRM → accept → route
     │    │    ├─ signed-in email ≠ invited email → MISMATCH CONFIRM → accept → route
     │    │    └─ otherwise → accept → route
     │    └─ does not resolve → clear stash, set banner, fall through to 4
     └─ stash older than 7 days → clear silently, fall through to 4
4. memberships non-empty          → /admin or /collect by newest-joined role
5. claim_invite_by_email()
     ├─ 0 matches → /signup?nomatch=<email>
     ├─ 1 match   → INTERSTITIAL ("Joining <Mandal> as <role>") → accept → route
     └─ n matches → PICKER → accept → route
```

Note the ordering consequence: step 5 is only reachable with **zero** memberships,
so neither the second-mandal confirm nor the mismatch confirm can arise there — an
email match is by definition not a mismatch. Both confirms are reachable only from a
token/code (step 3, and `/join/:token`).

A failed stash **never dead-ends**. It clears the stash, shows one banner explaining
why (expired / revoked / already used / invalid), and continues to step 4.

### The stash

`localStorage['vm.pendingInvite'] = { token, writtenAt }`, written before any
Google/magic-link round trip that starts from an invite context (`/join/:token`, or
the `/signup` code field). Cleared on success, on failure, and on age > 7 days.

**Both rescue mechanisms are load-bearing; neither is an optimization.**
The stash survives **OAuth** — same browser, same origin, one round trip. It does
**not** reliably survive a **magic link**: the invitee taps the link in Gmail on
their phone and lands in the system browser, a different context with empty
localStorage. For magic-link users, `claim_invite_by_email()` (step 5) is the
*primary* path, not a fallback.

Separately, add `https://<domain>/join/**` and `https://<domain>/continue` to
Supabase → Auth → URL Configuration → Redirect URLs. That makes the happy path one
hop instead of two. Belt and braces — it is no longer the fix.

## §3 — `/signup`, pre-auth

Renders the two-card choice **whether or not a session exists**.

**Card A — Create a mandal**
- No session → `AuthMethods` with `redirectTo=/signup?next=create`, which re-enters
  create mode on return rather than dumping the user back on the choice screen.
- Session → call `claim_invite_by_email()` once. If it returns anything, show the
  **interjection**: *"You have a pending invite to **Ganesh Mandal** — join it, or
  create a new mandal anyway?"* This kills the duplicate-mandal failure class, where
  an invited user taps the first card simply because it is first.
- Then the existing mandal-creation form, unchanged.

**Card B — I was invited**
- No session → `AuthMethods` with `redirectTo=/continue`, copy: *"Sign in with the
  email your admin invited — we'll find your invite automatically."* Plus a
  secondary, always-available **invite code** field.
- Session → navigate to `/continue`, which runs the email claim.
- `?nomatch=<email>` renders this card with *"No invite found for
  priya.shah@gmail.com. Enter the code your admin gave you."* — an honest failure
  state with the fix in reach, not a dead end.

**Code input normalization.** Uppercase, strip every non-alphanumeric, client **and**
server. Someone will type `k7m29 xpq4r`. The field also still accepts a pasted
`/join/...` or legacy `/invite/...` URL via the existing `extractJoinToken`, because
people will paste the link into the box labelled "code".

## §4 — One migration (`20260729120000_auth_onboarding_v6.sql`)

1. **`invites.code text`** — 10 chars from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`
   (31 symbols; no `I L O 0 1`), ≈49.5 bits. Displayed `K7M29-XPQ4R`, stored
   unformatted and uppercase. Generated from `gen_random_bytes`, not `random()`.
   Uniqueness via a **partial unique index on non-consumed AND non-revoked rows
   only** — the predicate cannot reference `now()` (not immutable), so expiry stays
   a lookup-time check. Generation retries on `unique_violation`, same shape as
   `create_mandal`'s slug loop.
2. **`create_invite`** — email now **required**; stored `lower(btrim(email))`.
   Mints a code alongside the token.
3. **`resend_invite`** — mints a new code alongside the new token.
4. **`accept_invite(token_or_code)`** — resolves by `token_hash` first, then by
   normalized `code`. The code lookup is **not** filtered to live rows; it orders
   live rows first and falls back to the most recent dead row, so a double-tap after
   a successful join hits the existing idempotency branch instead of an error.
   Email lock **removed** — possession of the link or code is proof. The `users` row
   records the **actual signed-in email**, normalized, not the invited one. A
   `unique_violation` on `users_mandal_email_key` is translated to a readable
   message. Expiry / revoked / consumed / idempotency / the `FOR UPDATE` replay lock
   / the deactivate-bypass gate are all unchanged from `20260720150000`.
5. **`claim_invite_by_email()`** — new, authenticated-only. Matches live invites on
   `lower(email)` = the caller's **verified** (`email_confirmed_at is not null`)
   auth email. Returns **all** matches as `(code, mandal_name, role, invitee_name)`
   — one → client claims after the interstitial, several → client shows the picker.
   Never silently picks "newest". Returns the code rather than a bare id so the
   client reuses the single `accept_invite` path.
6. **`invite_preview(token_or_code)`** — return type changes (drop + create), adding
   `invitee_email_masked`. Also resolves a code, so `/join/K7M29XPQ4R` works.
7. **`list_pending_invites`** — return type changes (drop + create), adding `code`.
8. **Backfill** — `update invites set email = lower(btrim(email))` for existing
   rows, or `claim_invite_by_email` misses them; and mint codes for existing live
   invites.

## §5 — Membership rule

A user **can hold multiple memberships**. Confirming a second mandal **adds** a
membership; it does not move one. Routing then follows the newest-joined membership
— the same rule `app_mandal_id()` applies server-side (see §0 C1). A mandal switcher
in the nav is a small follow-up, not part of this migration.

Both `/join/:token` and the stash path show the second-mandal confirm before
accepting. Email auto-claim never reaches it (§2) and so never silently switches.

## §6 — Roles: no change

`set_member_role` is already owner-only and accepts only `admin`|`volunteer`; owner
is reachable only through `transfer_ownership`. `members.tsx:307` already renders
Make admin / Make volunteer. Verified against the current code, not rebuilt.

## §7 — Edge-case ledger

Every row is a test case and the acceptance checklist.

| Situation | Behavior |
|---|---|
| Stashed token expired / revoked / consumed | Clear stash, banner, fall through to membership check — never a dead end |
| Stash older than 7 days | Ignore + clear silently |
| Magic link opened in a different browser/device | Stash absent → rescued by `claim_invite_by_email` |
| Admin typo'd email case (`Priya.Shah@…`) | Normalization makes the match succeed anyway |
| Gmail dot-variant (`priyashah` vs `priya.shah`) | Known miss — code entry is the covered fallback |
| Two live invites for the same email | Picker; never newest-wins |
| Signed-in email ≠ invite email on token/code accept | Mismatch confirm with a switch-account out |
| Invited user taps "Create a mandal" | Post-auth interjection offers the pending invite first |
| Already a member elsewhere, any token path | Second-mandal confirm; **adds** a membership on confirm |
| Code typed lowercase / with spaces / with dashes | Normalized both sides before lookup |
| Invite consumed twice (double-tap, refresh) | Idempotent no-op success, via the code lookup's dead-row fallback |
| Invite's email already belongs to another member of that mandal | Readable error, not a raw constraint violation |
| Deactivated member replays a stale consumed token | Still blocked (`20260720150000` gate, untouched) |

## Non-goals

- Mandal switcher in the nav.
- Server-side invite emails — still copy-link / WhatsApp share.
- Rate limiting on code lookup. The code is single-use, 7-day, and revocable; that
  is the accepted mitigation for making it bearer.

## Build order

1. Migration (§4).
2. Resolver (§2) — this is where the "back to landing page" bug actually dies.
3. `/signup` cards, Card A interjection, code entry (§3).
4. Second-mandal + mismatch confirms (§5), shared by `/join/:token` and the resolver.
5. Landing link fixes (§1) — trivial, any time.
6. Walk the §7 ledger.
