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

// Task 8: `sms:` links have no delivery confirmation, so this only records
// that the volunteer's device was told to open the SMS composer — same
// optimistic, trust-based pattern as the rest of the app. Not guarded by
// forbid_financial_edit() (see the donations_sms_sent migration), and the
// existing donations_volunteer_update/donations_admin_update RLS policies
// already permit it.
export async function markSmsSent(donationId: string): Promise<void> {
  const { error } = await supabase
    .from('donations')
    .update({ sms_sent_at: new Date().toISOString() })
    .eq('id', donationId)
  if (error) throw error
}

// Task 8's "Pending send" tray: the given volunteer's own donations that
// haven't had an SMS sent yet, most recent first.
export async function getPendingSendDonations(collectedBy: string): Promise<Donation[]> {
  const { data, error } = await supabase
    .from('donations')
    .select('*')
    .eq('collected_by', collectedBy)
    .is('sms_sent_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
