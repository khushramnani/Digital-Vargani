// Admin donor directory (plan v4 §1b). The heavy lifting — grouping non-voided
// donations by donor identity (phone-or-name) and summing per donor — happens
// server-side in the `donors_summary` RPC (admin-only, mandal-scoped via RLS),
// so the client never ships or re-sums the whole donation table. Snake→camel
// here keeps the screen reading in the app's own casing.
import { supabase } from './client'

export type DonorSummary = {
  donorKey: string
  donorName: string
  donorPhone: string
  totalPaise: number
  donationCount: number
  firstAt: string
  lastAt: string
}

// `year` undefined ⇒ all years (the RPC's p_year defaults to null). Returns []
// for a mandal with no donations rather than throwing — an empty directory is
// an expected state, not an error.
export async function getDonorsSummary(year?: number): Promise<DonorSummary[]> {
  const { data, error } = await supabase.rpc('donors_summary', { p_year: year })
  if (error) throw error
  return (data ?? []).map((r) => ({
    donorKey: r.donor_key,
    donorName: r.donor_name,
    donorPhone: r.donor_phone,
    totalPaise: r.total_paise,
    donationCount: r.donation_count,
    firstAt: r.first_at,
    lastAt: r.last_at,
  }))
}
