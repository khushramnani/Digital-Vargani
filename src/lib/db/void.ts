// Generic void for the three append-only financial tables. Routes through the
// void_row RPC (SECURITY DEFINER) rather than a direct UPDATE: the RPC stamps
// voided_by/voided_at from the session (the client can't forge them), and the
// forbid_financial_edit trigger makes the void one-way — see audit 2026-07-18
// #2 and 20260718120000_void_rpc_and_one_way.sql. Who may void which row
// (admin: any; volunteer: their own) is enforced inside the RPC.
import { supabase } from './client'

export type VoidableTable = 'donations' | 'expenses' | 'handovers'

export async function voidRow(table: VoidableTable, id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('void_row', {
    target_table: table,
    row_id: id,
    reason,
  })
  if (error) throw error
}

// Admin-only bulk void of the whole mandal's donation ledger — the "clear
// all donations" companion to per-row delete. Goes through the
// clear_donation_history RPC (SECURITY DEFINER, is_admin() + mandal-scoped)
// rather than a client-side loop: one atomic statement, and the voided_by /
// mandal predicate are set server-side where they can't be forged. Returns
// how many rows were cleared.
export async function clearAllDonations(reason: string): Promise<number> {
  const { data, error } = await supabase.rpc('clear_donation_history', { reason })
  if (error) throw error
  return data ?? 0
}

// The permanent, true DELETE companion to the soft void above (v4 §8) — the
// mandal's "empty the removed history" / "wipe the season" nuclear option.
// Goes through the purge_donations RPC (SECURITY DEFINER, is_admin() +
// mandal-scoped, search_path pinned) because RLS deliberately has NO DELETE
// policy: the definer function is the only path that can hard-delete a
// financial row, so a raw client still can't. 'removed' erases already-voided
// rows only; 'all' erases the entire history. Returns how many rows were deleted.
export async function purgeDonations(scope: 'removed' | 'all'): Promise<number> {
  const { data, error } = await supabase.rpc('purge_donations', { scope })
  if (error) throw error
  return data ?? 0
}
