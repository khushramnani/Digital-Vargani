// Typed wrappers for the two transparency RPCs. Both pre-aggregate
// server-side and are addressed by mandal slug — the slug is what the
// public /transparency/:slug route carries, and what scopes the sums to one
// mandal. Both are gated on that mandal's transparency_published (bypassed
// only for an admin of that same mandal) — an unpublished report returns
// zero rows, not zeroed totals, so getReport/getCategories return null/[]
// rather than a fabricated all-zero shape, letting callers tell "not
// published yet" apart from "published, nothing collected". An unknown slug
// returns zero rows too, so it is indistinguishable from an unpublished one.
import { supabase } from './client'

export type TransparencyTotals = {
  // From the 20260717190000 migration — the report titles itself with this.
  mandalName: string
  totalCollectedPaise: number
  totalExpensesPaise: number
}
export type CategoryBreakdown = { category: string; amountPaise: number }

export async function getTransparencyReport(mandalSlug: string): Promise<TransparencyTotals | null> {
  const { data, error } = await supabase.rpc('get_transparency_report', { mandal_slug: mandalSlug })
  if (error) throw error
  const row = data?.[0]
  if (!row) return null
  return {
    mandalName: row.mandal_name,
    totalCollectedPaise: row.total_collected_paise,
    totalExpensesPaise: row.total_expenses_paise,
  }
}

export async function getTransparencyCategories(mandalSlug: string): Promise<CategoryBreakdown[]> {
  const { data, error } = await supabase.rpc('get_transparency_categories', { mandal_slug: mandalSlug })
  if (error) throw error
  return (data ?? []).map((row) => ({ category: row.category, amountPaise: row.amount_paise }))
}
