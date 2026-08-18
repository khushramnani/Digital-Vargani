// Assembles a `Ledger` (lib/reconcile.ts, the money-correctness core) from
// Supabase. RLS already scopes donations/expenses/handovers per-role
// server-side (Task 2 migration, same pattern as db/expenses.ts /
// db/handovers.ts) — a volunteer's select only ever returns their own rows,
// so fetchLedgerRows works unmodified for either role.
import { supabase } from './client'
import { getMandal } from './config'
import type { Ledger, LedgerDonation, LedgerExpense, LedgerHandover, LedgerUser } from '../reconcile'

type LedgerRows = Pick<Ledger, 'donations' | 'expenses' | 'handovers'>

// One PostgREST page. Supabase's API "Max rows" setting defaults to 1000, so a
// plain unlimited select is silently capped there.
export const LEDGER_PAGE = 1000

// Every row of one table, paged — NOT a plain select.
//
// This is the reconciliation core's input: a silent 1000-row cap here would
// understate totalCollected/cashHeldByTreasurer/volunteerCashInHand and make
// booksBalanceCheck report a discrepancy that only exists because rows were
// dropped in transit. The redesign puts those figures in the largest type on the
// Overview hero, so the cap had to go. Same paging shape as getDonationsLite:
// stable order with an id tiebreak so a row appended mid-fetch lands after the
// cursor, the exact count from each page, and an empty-page stop so rows purged
// mid-fetch can't make it spin.
async function fetchAllRows<T>(table: 'donations' | 'expenses' | 'handovers', columns: string): Promise<T[]> {
  const rows: T[] = []
  for (;;) {
    const { data, error, count } = await supabase
      .from(table)
      .select(columns, { count: 'exact' })
      .order('id', { ascending: true })
      .range(rows.length, rows.length + LEDGER_PAGE - 1)
    if (error) throw error
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length === 0 || (count !== null && rows.length >= count)) return rows
  }
}

type DonationRow = { amount_paise: number; mode: string; collected_by: string; voided: boolean }
type ExpenseRow = { amount_paise: number; paid_from: string; paid_by: string; voided: boolean }
type HandoverRow = { amount_paise: number; volunteer_id: string; received_by: string; voided: boolean }

export async function fetchLedgerRows(): Promise<LedgerRows> {
  const [donationRows, expenseRows, handoverRows] = await Promise.all([
    fetchAllRows<DonationRow>('donations', 'amount_paise, mode, collected_by, voided'),
    fetchAllRows<ExpenseRow>('expenses', 'amount_paise, paid_from, paid_by, voided'),
    fetchAllRows<HandoverRow>('handovers', 'amount_paise, volunteer_id, received_by, voided'),
  ])

  const donations: LedgerDonation[] = donationRows.map((d) => ({
    amountPaise: d.amount_paise,
    mode: d.mode as LedgerDonation['mode'],
    collectedBy: d.collected_by,
    voided: d.voided,
  }))
  const expenses: LedgerExpense[] = expenseRows.map((e) => ({
    amountPaise: e.amount_paise,
    paidFrom: e.paid_from as LedgerExpense['paidFrom'],
    paidBy: e.paid_by,
    voided: e.voided,
  }))
  const handovers: LedgerHandover[] = handoverRows.map((h) => ({
    amountPaise: h.amount_paise,
    volunteerId: h.volunteer_id,
    receivedBy: h.received_by,
    voided: h.voided,
  }))

  return { donations, expenses, handovers }
}

export type VolunteerSummary = { id: string; name: string }

// Admin-only in practice (users_admin_select RLS) — used to drive the
// per-volunteer cash-in-hand breakdown (Task 13).
export async function fetchActiveVolunteers(): Promise<VolunteerSummary[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, name')
    .eq('role', 'volunteer')
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

// Admin-only (mandals_admin_select + users_admin_select RLS): the
// full `Ledger`, including every user and the bank opening balance, for
// the aggregates (cashHeldByTreasurer, booksBalanceCheck) that need them —
// Task 15's master ledger. Cash-in-hand (Task 13) only ever needs
// fetchLedgerRows(), since volunteerCashInHand doesn't touch ledger.users.
export async function fetchFullLedger(): Promise<Ledger> {
  const [rows, usersRes, mandal] = await Promise.all([
    fetchLedgerRows(),
    supabase.from('users').select('id, role'),
    getMandal(),
  ])
  if (usersRes.error) throw usersRes.error

  const users: LedgerUser[] = (usersRes.data ?? []).map((u) => ({
    id: u.id,
    role: u.role as LedgerUser['role'],
  }))

  return { ...rows, users, bankOpeningPaise: mandal.bank_opening_paise }
}
