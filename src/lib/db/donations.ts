// Typed insert for the `donations` table. `receipt_no` / `public_token` /
// `created_at` are never sent from the client — a BEFORE INSERT trigger
// (enforce_insert_defaults, see Task 2 migration) unconditionally overwrites
// them regardless of what's sent, so omitting them here is the honest,
// self-documenting thing to do. `.select().single()` returns the post-trigger
// row so the caller gets the server-generated receipt_no back.
import { supabase } from './client'
import type { Tables } from './database.types'
import type { DonationMode } from '../validation/donation'

export type Donation = Tables<'donations'>

export type CreateDonationInput = {
  donorName: string
  donorPhone: string
  amountPaise: number
  mode: DonationMode
  // Always the current session's acting user id (appUser.id from useAuth()),
  // never a value the form lets the user pick.
  collectedBy: string
}

export async function createDonation(input: CreateDonationInput): Promise<Donation> {
  const { data, error } = await supabase
    .from('donations')
    .insert({
      donor_name: input.donorName,
      donor_phone: input.donorPhone,
      amount_paise: input.amountPaise,
      mode: input.mode,
      collected_by: input.collectedBy,
    })
    .select()
    .single()
  if (error) throw error
  return data
}
