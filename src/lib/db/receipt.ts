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
import type { Database, Json } from './database.types'

// void_reason is corrected to `| null` here: the hosted type generator can't
// infer nullability through a `language sql returns table(...)` function, so
// it always emits the column as non-null even though donations.void_reason
// (and thus this RPC's real result for a non-voided receipt) is nullable.
// The same applies to every nullable branding column (city / president_name /
// creator_phone are all optional mandal-profile fields).
export type PublicReceipt = Omit<
  Database['public']['Functions']['get_public_receipt']['Returns'][number],
  'void_reason' | 'logo_url' | 'signature_url' | 'city' | 'president_name' | 'creator_phone'
> & {
  void_reason: string | null
  logo_url: string | null
  signature_url: string | null
  city: string | null
  president_name: string | null
  creator_phone: string | null
}

// One inquiry contact rendered on the receipt footer (F6).
export type InquiryContact = { name: string; phone: string }

// inquiry_contacts is a jsonb column surfaced as untyped Json — coerce it
// defensively into a typed list, dropping anything that isn't a {name, phone}
// object so malformed rows can never crash the public receipt.
export function parseInquiryContacts(value: Json): InquiryContact[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((c) =>
    c && typeof c === 'object' && !Array.isArray(c) && typeof c.name === 'string' && typeof c.phone === 'string'
      ? [{ name: c.name, phone: c.phone }]
      : [],
  )
}

// Returns null for a bogus/unknown token (RPC returns zero rows) rather than
// throwing — that's the "not found" state, not an error state.
export async function getPublicReceipt(token: string): Promise<PublicReceipt | null> {
  const { data, error } = await supabase.rpc('get_public_receipt', { token })
  if (error) throw error
  return data?.[0] ?? null
}
