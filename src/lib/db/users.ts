// id → display-name lookup for the mandal's users, so admin screens can label a
// donation's `collected_by` (a users.id) and the Donors directory can name who
// took each donation. Admin-only in practice: users_admin_select RLS returns
// every user in the caller's own mandal (active + inactive, admins + volunteers),
// which is exactly the coverage a per-row "collected by <name>" needs — unlike
// fetchActiveVolunteers, which is active-volunteers-only. Volunteer sessions get
// nothing back (no volunteer-facing users policy), so callers must be admin.
import { supabase } from './client'

export async function fetchMandalUserNames(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('users').select('id, name')
  if (error) throw error
  return Object.fromEntries((data ?? []).map((u) => [u.id, u.name]))
}
