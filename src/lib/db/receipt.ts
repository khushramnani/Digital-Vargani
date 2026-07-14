// Typed read access for the public receipt page (Task 9). Both surfaces
// here are the safe-by-construction ones from Task 2: get_public_receipt's
// return row never includes donor_phone at the SQL level (see
// database.types.ts), and public_mandal_branding exposes only the branding
// columns an admin configures. Never query `donations` directly here — RLS
// would block an anonymous client anyway, but the RPC/view are the correct/
// only intended path.
import { supabase } from './client'
import type { Database, Tables } from './database.types'

export type PublicReceipt = Database['public']['Functions']['get_public_receipt']['Returns'][number]
export type MandalBranding = Tables<'public_mandal_branding'>

// Returns null for a bogus/unknown token (RPC returns zero rows) rather than
// throwing — that's the "not found" state, not an error state.
export async function getPublicReceipt(token: string): Promise<PublicReceipt | null> {
  const { data, error } = await supabase.rpc('get_public_receipt', { token })
  if (error) throw error
  return data?.[0] ?? null
}

export async function getPublicBranding(): Promise<MandalBranding | null> {
  const { data, error } = await supabase.from('public_mandal_branding').select('*').maybeSingle()
  if (error) throw error
  return data
}
