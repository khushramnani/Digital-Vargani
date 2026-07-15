// Typed wrappers for the two transparency RPCs (Task 16 migration). Both
// pre-aggregate server-side and are gated on mandal_config.
// transparency_published (bypassed for an admin caller) — an unpublished
// report returns zero rows, not zeroed totals, so getReport/getCategories
// return null/[] rather than a fabricated all-zero shape, letting callers
// tell "not published yet" apart from "published, nothing collected".
import { supabase } from './client'

export type TransparencyTotals = { totalCollectedPaise: number; totalExpensesPaise: number }
export type CategoryBreakdown = { category: string; amountPaise: number }

export async function getTransparencyReport(): Promise<TransparencyTotals | null> {
  const { data, error } = await supabase.rpc('get_transparency_report')
  if (error) throw error
  const row = data?.[0]
  if (!row) return null
  return { totalCollectedPaise: row.total_collected_paise, totalExpensesPaise: row.total_expenses_paise }
}

export async function getTransparencyCategories(): Promise<CategoryBreakdown[]> {
  const { data, error } = await supabase.rpc('get_transparency_categories')
  if (error) throw error
  return (data ?? []).map((row) => ({ category: row.category, amountPaise: row.amount_paise }))
}
