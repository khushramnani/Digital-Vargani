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
  // Task 10: the offline queue's Dexie `localId`, sent unchanged as
  // `client_idempotency_key` — the dedup key a retried sync uses to
  // recognize "this exact item already made it to the server" (see
  // src/lib/queue/sync.ts). Left undefined (sent as null) for any insert
  // that isn't going through the offline queue.
  clientIdempotencyKey?: string
}

export async function createDonation(input: CreateDonationInput): Promise<Donation> {
  const { data, error } = await supabase
    .from('donations')
    .insert({
      donor_name: input.donorName,
      // Optional (audit #8): an empty phone lands as NULL, not '' — the column
      // is nullable and downstream "has a phone?" checks read cleaner for it.
      donor_phone: input.donorPhone || null,
      amount_paise: input.amountPaise,
      mode: input.mode,
      collected_by: input.collectedBy,
      client_idempotency_key: input.clientIdempotencyKey ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Task 10: the offline queue's idempotency-recovery lookup — used when a
// sync attempt gets a unique-violation on client_idempotency_key, meaning
// this exact item already synced on a previous attempt (the app likely
// closed/crashed after the server insert succeeded but before the local
// outbox row was deleted). Returns null rather than throwing when no row
// matches, since "not found" is an expected outcome for a fresh key, not
// an error.
export async function getDonationByIdempotencyKey(key: string): Promise<Donation | null> {
  const { data, error } = await supabase
    .from('donations')
    .select('*')
    .eq('client_idempotency_key', key)
    .maybeSingle()
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

// The "my collections" (volunteer) / "all collections" (admin) list SPEC.md
// names — every donation, not just the not-yet-sent subset
// getPendingSendDonations returns. RLS (donations_volunteer_select /
// donations_admin_select, Task 2 migration) already scopes rows per-role
// server-side, same transparent pattern as getExpenses/getHandovers, so
// this one query works unmodified for either caller.
export async function getDonations(): Promise<Donation[]> {
  const { data, error } = await supabase
    .from('donations')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
