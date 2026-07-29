// Data access for the v5 membership model: the Manage Members screen (list
// + invite + per-row actions) and the /join/:token flow both live here,
// same as users.ts's fetchMandalUserNames — one file per data concern.
//
// Every function here wraps a failure in a real `Error` (not the raw
// PostgrestError supabase-js returns), same reasoning as mandals.ts's
// createMandal: a PostgrestError is a plain object, not an Error instance,
// so `err instanceof Error ? err.message : String(err)` — the pattern every
// caller of this file uses (members.tsx, JoinInvite.tsx) — would silently
// degrade to the useless "[object Object]" on a raw throw. (Some older
// files in this codebase — users.ts, void.ts — throw raw and happen to feed
// callers that use the same instanceof-Error pattern anyway, which is a
// pre-existing latent bug there, not a convention worth repeating here.)
import { supabase } from './client'
import type { Tables } from './database.types'

export type Member = Tables<'users'>

export type PendingInvite = {
  id: string
  role: string
  name: string
  email: string | null
  phone: string | null
  // The typeable half of the invite. Nullable only for pre-v6 rows that
  // predate the code column; every invite minted since carries one.
  code: string | null
  expiresAt: string
  createdAt: string
}

// Both halves of a freshly minted invite. The server returns each exactly
// once (only the token's hash is stored), so a caller that drops either has
// nothing to share and no way to get it back except a resend.
export type NewInvite = { token: string; code: string }

// inviteeEmailMasked is masked server-side (p***a@gmail.com) because
// invite_preview is anon-callable — enough to name the address in the
// "this was sent to someone else, continue anyway?" confirm, not enough to
// harvest. matchesCallerEmail is the actual decision: it's computed against
// the real addresses server-side, since two different ones can mask to the
// same string.
export type InvitePreview = {
  mandalName: string
  role: string
  invitee: string
  inviteeEmailMasked: string | null
  matchesCallerEmail: boolean
}

// A live invite addressed to the signed-in user's own verified email — the
// rescue path for someone who arrived without a link or code at all.
export type MyInvite = { code: string; mandalName: string; role: string; invitee: string }

// users_admin_select RLS already returns every member (owner+admin+
// volunteer, active+inactive) in the caller's own mandal — no RPC needed,
// same as admins.tsx/volunteers.tsx's old fetches. But users_self_select (an
// older, deliberately mandal-unscoped policy — it's what bootstraps
// app_mandal_id() in the first place) combines via OR with
// users_admin_select, so a caller who holds memberships in more than one
// mandal (v5 allows this) would otherwise get their OWN row in a *different*
// mandal back too. Filter explicitly by the caller's mandal so that
// self-select's necessarily-broader RLS scope can't leak into this screen.
export async function fetchMembers(mandalId: string): Promise<Member[]> {
  const { data, error } = await supabase.from('users').select('*').eq('mandal_id', mandalId).order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function fetchPendingInvites(): Promise<PendingInvite[]> {
  const { data, error } = await supabase.rpc('list_pending_invites')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    phone: row.phone,
    code: row.code,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }))
}

// email is required as of v6: it's what makes my_pending_invites() able to
// find this invite when the invitee arrives with neither half of it, which
// is the normal case for anyone who opened a magic link on their phone.
export async function createInvite(
  role: 'admin' | 'volunteer',
  name: string,
  email: string,
  phone?: string,
): Promise<NewInvite> {
  const { data, error } = await supabase.rpc('create_invite', { role, name, email, phone })
  if (error) throw new Error(error.message)
  return firstInvite(data)
}

// The RPC returns a one-row set. An empty result would mean the insert
// silently did nothing — impossible in practice, but returning
// `{token: undefined}` from here would surface as an invite sheet showing
// "/join/undefined", which is worse than an error.
function firstInvite(rows: { token: string; code: string }[] | null): NewInvite {
  const row = rows?.[0]
  if (!row?.token || !row?.code) throw new Error('The invite was not created. Please try again.')
  return { token: row.token, code: row.code }
}

export async function revokeInvite(id: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_invite', { invite_id: id })
  if (error) throw new Error(error.message)
}

export async function resendInvite(id: string): Promise<NewInvite> {
  const { data, error } = await supabase.rpc('resend_invite', { invite_id: id })
  if (error) throw new Error(error.message)
  return firstInvite(data)
}

export async function setMemberRole(id: string, role: 'admin' | 'volunteer'): Promise<void> {
  const { error } = await supabase.rpc('set_member_role', { member_id: id, new_role: role })
  if (error) throw new Error(error.message)
}

export async function transferOwnership(id: string): Promise<void> {
  const { error } = await supabase.rpc('transfer_ownership', { member_id: id })
  if (error) throw new Error(error.message)
}

export async function deactivateMember(id: string): Promise<void> {
  const { error } = await supabase.rpc('deactivate_member', { member_id: id })
  if (error) throw new Error(error.message)
}

export async function reactivateMember(id: string): Promise<void> {
  const { error } = await supabase.rpc('reactivate_member', { member_id: id })
  if (error) throw new Error(error.message)
}

// Public (pre-session) — used by /join/:token before any auth has happened.
// Checks `error` explicitly (unlike a bare `data?.[0]` read) so a genuine RPC
// failure (network blip, unexpected server exception) throws instead of
// being indistinguishable from "this token doesn't resolve to a live
// invite" — the caller (JoinInvite) still folds both into the same
// invalid-link UI, but that's its choice to make, not this function's.
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const { data, error } = await supabase.rpc('invite_preview', { token })
  if (error) throw new Error(error.message)
  const row = data?.[0]
  return row
    ? {
        mandalName: row.mandal_name,
        role: row.role,
        invitee: row.invitee_name,
        inviteeEmailMasked: row.invitee_email_masked ?? null,
        matchesCallerEmail: row.matches_caller_email ?? false,
      }
    : null
}

// Accepts either half — a raw link token or a normalized code.
export async function acceptInvite(token: string): Promise<void> {
  const { error } = await supabase.rpc('accept_invite', { token })
  if (error) throw new Error(error.message)
}

// Live invites addressed to the caller's own VERIFIED email, in any mandal.
// Returns every match rather than picking one: two mandals inviting the same
// person is a real scenario, and silently joining the "newest" would put
// them in the wrong one with no signal that a choice was ever made.
export async function myPendingInvites(): Promise<MyInvite[]> {
  const { data, error } = await supabase.rpc('my_pending_invites')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    code: row.code,
    mandalName: row.mandal_name,
    role: row.role,
    invitee: row.invitee_name,
  }))
}
