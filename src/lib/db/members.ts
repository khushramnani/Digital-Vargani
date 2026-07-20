// Data access for the v5 membership model: the Manage Members screen (list
// + invite + per-row actions) and the /join/:token flow both live here,
// same as users.ts's fetchMandalUserNames — one file per data concern.
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
  if (error) throw error
  return data ?? []
}

export async function fetchPendingInvites(): Promise<PendingInvite[]> {
  const { data, error } = await supabase.rpc('list_pending_invites')
  if (error) throw error
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
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const { data } = await supabase.rpc('invite_preview', { token })
  const row = data?.[0]
  return row ? { mandalName: row.mandal_name, role: row.role, invitee: row.invitee_name } : null
}

export async function acceptInvite(token: string): Promise<void> {
  const { error } = await supabase.rpc('accept_invite', { token })
  if (error) throw new Error(error.message)
}
