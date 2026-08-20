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

// Where the donation came from. Plan 2026-08-18 §1 made the list per-mandal and
// renameable, so this is the source NAME as text — not one of three slugs any
// more. The DB CHECK is now length-only (1..40 chars); rows written before that
// migration still carry 'society'/'shop'/'other' and display through
// lib/sources.ts's legacy label map. Kept as a named alias because "a string
// that is a donation source" is the thing every call site actually means.
export type DonationCategory = string

export type CreateDonationInput = {
  donorName: string
  donorPhone: string
  amountPaise: number
  mode: DonationMode
  // Donation source — the form always sends one (the mandal's first source, or
  // the volunteer's remembered pick).
  category: DonationCategory
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
      category: input.category,
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
//
// Plan 2026-08-18 §2: a donation logged WITHOUT a phone is excluded outright.
// There is no number to send a receipt to, so sms_sent_at will never be set and
// the row otherwise sits in the tray forever — a permanent false "you still owe
// someone a receipt" (audit #4 only removed the dead buttons from those rows).
export async function getPendingSendDonations(collectedBy: string): Promise<Donation[]> {
  const { data, error } = await supabase
    .from('donations')
    .select('*')
    .eq('collected_by', collectedBy)
    .is('sms_sent_at', null)
    .not('donor_phone', 'is', null)
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
// Bounded (audit 2026-07-18 #9): most-recent-first with an explicit cap, so a
// big mandal's ledger doesn't fetch-and-render thousands of rows on a low-end
// phone. ponytail: a hard cap, not pagination — add a "load more" when a
// mandal legitimately needs to browse past the most recent 1000 donations.
export async function getDonations(): Promise<Donation[]> {
  const { data, error } = await supabase
    .from('donations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw error
  return data ?? []
}

// The aggregate-safe shape (plan 2026-08-16 §2c): what the dashboard cards,
// the day summaries and the Collections totals strip need — and, for the
// search filter to be applied identically to the list and to the totals,
// the same searchable fields (donor_name/donor_phone/receipt_no).
export type DonationLite = Pick<
  Donation,
  'amount_paise' | 'mode' | 'category' | 'collected_by' | 'created_at' | 'voided' | 'donor_name' | 'donor_phone' | 'receipt_no'
>

const LITE_COLUMNS =
  'amount_paise, mode, category, collected_by, created_at, voided, donor_name, donor_phone, receipt_no'

// One PostgREST page. Supabase's API "Max rows" setting defaults to 1000, so
// a plain unlimited select is silently capped there — the same cap
// getDonations() applies on purpose. Paging is what makes this query
// genuinely uncapped.
export const LITE_PAGE = 1000

// Every donation the caller may see (RLS-scoped exactly like getDonations:
// admins the whole mandal, a volunteer only their own rows), narrowed to the
// lite columns and NEVER capped — a season past 1000 donations must not
// silently undercount a day total or the fund pool. Pages oldest-first with
// an id tiebreak so a donation appended mid-fetch lands after the cursor
// instead of shifting rows across page boundaries. Each page also carries the
// exact row count, and the cursor advances by what actually came back, so the
// loop is right even if the project's Max rows is later lowered below
// LITE_PAGE (it would just take more pages); it stops on an empty page too,
// so rows purged mid-fetch can't make it spin.
export async function getDonationsLite(): Promise<DonationLite[]> {
  const rows: DonationLite[] = []
  for (;;) {
    const { data, error, count } = await supabase
      .from('donations')
      .select(LITE_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(rows.length, rows.length + LITE_PAGE - 1)
    if (error) throw error
    const page = data ?? []
    rows.push(...page)
    // A missing count (no Content-Range reached the client) must not end the
    // loop early — fall through to the empty-page stop instead. And NOT a
    // short-page stop: if the project's Max rows is set below LITE_PAGE, every
    // page is short and stopping there would silently drop the rest.
    if (page.length === 0 || (count !== null && rows.length >= count)) return rows
  }
}
