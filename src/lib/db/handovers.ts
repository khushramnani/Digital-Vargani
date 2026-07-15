// Typed query module for `handovers`. RLS (handovers_admin_* /
// handovers_volunteer_*, Task 2 migration) already scopes rows per-role
// server-side — admin sees/writes every row, a volunteer only rows where
// volunteer_id = app_user_id() — so a single plain `select *` (see
// getHandovers) returns the right rows for either caller with no
// client-side role branching, same pattern as lib/db/expenses.ts. The
// append-only trigger (forbid_financial_edit) blocks editing
// volunteer_id/amount_paise/received_by/note/created_at post-creation, but
// voided/void_reason/voided_by/voided_at aren't in that guarded list, so
// voidHandover's update is allowed through.
import { supabase } from './client'
import type { Tables } from './database.types'

export type Handover = Tables<'handovers'> & {
  volunteer?: { name: string } | null
  received_by_user?: { name: string } | null
}

// Shape returned by the list_admins() RPC (Task 12's migration) — a
// volunteer has no SELECT access to other users' rows (users_self_select),
// so this narrowly-scoped SECURITY DEFINER function is the only way to
// populate the "received by" picker.
export type Admin = { id: string; name: string }

export async function getAdmins(): Promise<Admin[]> {
  const { data, error } = await supabase.rpc('list_admins')
  if (error) throw error
  return data ?? []
}

export type CreateHandoverInput = {
  amountPaise: number
  receivedBy: string
  note: string
  // Always the current session's acting user id (appUser.id from
  // useAuth()), never a value the form lets the user pick — same pattern
  // Task 11 established for paid_by on expenses.
  volunteerId: string
}

export async function createHandover(input: CreateHandoverInput): Promise<Handover> {
  const { data, error } = await supabase
    .from('handovers')
    .insert({
      amount_paise: input.amountPaise,
      received_by: input.receivedBy,
      note: input.note || null,
      volunteer_id: input.volunteerId,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// RLS scopes rows per-role automatically (see file header) — no
// `.eq('volunteer_id', ...)` here, that would be redundant client-side
// role-branching RLS already does server-side. The volunteer/received_by_user
// embeds resolve both display names in one query; the fkey names disambiguate
// against handovers' other users FK (voided_by).
export async function getHandovers(): Promise<Handover[]> {
  const { data, error } = await supabase
    .from('handovers')
    .select(
      '*, volunteer:users!handovers_volunteer_id_fkey(name), received_by_user:users!handovers_received_by_fkey(name)',
    )
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function voidHandover(id: string, reason: string, voidedBy: string): Promise<void> {
  const { error } = await supabase
    .from('handovers')
    .update({
      voided: true,
      void_reason: reason,
      voided_by: voidedBy,
      voided_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}
