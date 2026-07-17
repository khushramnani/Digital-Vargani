// Generic void for the three append-only financial tables. Each has the
// identical voided/void_reason/voided_by/voided_at columns, and the
// forbid_financial_edit trigger (Task 2 migration) explicitly excludes
// those four from its append-only guard on every one of them — so one
// function replaces the near-duplicate voidExpense/voidHandover that Tasks
// 11/12 each wrote by hand.
import { supabase } from './client'

export type VoidableTable = 'donations' | 'expenses' | 'handovers'

export async function voidRow(table: VoidableTable, id: string, reason: string, voidedBy: string): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({
      voided: true,
      void_reason: reason,
      voided_by: voidedBy,
      voided_at: new Date().toISOString(),
    })
    .eq('id', id)
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
