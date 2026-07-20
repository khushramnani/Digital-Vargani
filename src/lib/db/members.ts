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
  expiresAt: string
  createdAt: string
}

export type InvitePreview = { mandalName: string; role: string; invitee: string }

// users_admin_select RLS already returns every member (owner+admin+
// volunteer, active+inactive) in the caller's own mandal — no RPC needed,
// same as admins.tsx/volunteers.tsx's old fetches.
export async function fetchMembers(): Promise<Member[]> {
  const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true })
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
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }))
}

export async function createInvite(role: 'admin' | 'volunteer', name: string, email?: string, phone?: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_invite', { role, name, email, phone })
  if (error) throw new Error(error.message)
  return data
}

export async function revokeInvite(id: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_invite', { invite_id: id })
  if (error) throw new Error(error.message)
}

export async function resendInvite(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('resend_invite', { invite_id: id })
  if (error) throw new Error(error.message)
  return data
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
  return row ? { mandalName: row.mandal_name, role: row.role, invitee: row.invitee_name } : null
}

export async function acceptInvite(token: string): Promise<void> {
  const { error } = await supabase.rpc('accept_invite', { token })
  if (error) throw new Error(error.message)
}
