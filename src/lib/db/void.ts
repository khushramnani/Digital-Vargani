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
