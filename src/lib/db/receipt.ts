// Typed read access for the public receipt page. get_public_receipt is
// safe by construction: it takes an unguessable token, returns exactly one
// row, and never includes donor_phone at the SQL level (see
// database.types.ts). It now also returns that receipt's own mandal
// branding — the public_mandal_branding view was a view over "the one row"
// and could not survive multi-tenancy, since it would have handed every
// mandal's branding to anon. Never query `donations` directly here — RLS
// would block an anonymous client anyway, but the RPC is the correct/only
// intended path.
import { supabase } from './client'
import type { Database } from './database.types'

// void_reason is corrected to `| null` here: the hosted type generator can't
// infer nullability through a `language sql returns table(...)` function, so
// it always emits the column as non-null even though donations.void_reason
// (and thus this RPC's real result for a non-voided receipt) is nullable.
// The same applies to every nullable branding column.
export type PublicReceipt = Omit<
  Database['public']['Functions']['get_public_receipt']['Returns'][number],
  'void_reason' | 'logo_url' | 'signature_url'
> & {
  void_reason: string | null
  logo_url: string | null
  signature_url: string | null
}

// Returns null for a bogus/unknown token (RPC returns zero rows) rather than
// throwing — that's the "not found" state, not an error state.
export async function getPublicReceipt(token: string): Promise<PublicReceipt | null> {
  const { data, error } = await supabase.rpc('get_public_receipt', { token })
  if (error) throw error
  return data?.[0] ?? null
}
