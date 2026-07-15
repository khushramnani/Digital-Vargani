// Assembles a `Ledger` (lib/reconcile.ts, the money-correctness core) from
// Supabase. RLS already scopes donations/expenses/handovers per-role
// server-side (Task 2 migration, same pattern as db/expenses.ts /
// db/handovers.ts) — a volunteer's select only ever returns their own rows,
// so fetchLedgerRows works unmodified for either role.
import { supabase } from './client'
import { getMandalConfig } from './config'
import type { Ledger, LedgerDonation, LedgerExpense, LedgerHandover, LedgerUser } from '../reconcile'

type LedgerRows = Pick<Ledger, 'donations' | 'expenses' | 'handovers'>

export async function fetchLedgerRows(): Promise<LedgerRows> {
  const [donationsRes, expensesRes, handoversRes] = await Promise.all([
    supabase.from('donations').select('amount_paise, mode, collected_by, voided'),
    supabase.from('expenses').select('amount_paise, paid_from, paid_by, voided'),
    supabase.from('handovers').select('amount_paise, volunteer_id, received_by, voided'),
  ])
  if (donationsRes.error) throw donationsRes.error
  if (expensesRes.error) throw expensesRes.error
  if (handoversRes.error) throw handoversRes.error

  const donations: LedgerDonation[] = (donationsRes.data ?? []).map((d) => ({
    amountPaise: d.amount_paise,
    mode: d.mode as LedgerDonation['mode'],
    collectedBy: d.collected_by,
    voided: d.voided,
  }))
  const expenses: LedgerExpense[] = (expensesRes.data ?? []).map((e) => ({
    amountPaise: e.amount_paise,
    paidFrom: e.paid_from as LedgerExpense['paidFrom'],
    paidBy: e.paid_by,
    voided: e.voided,
  }))
  const handovers: LedgerHandover[] = (handoversRes.data ?? []).map((h) => ({
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

// Admin-only (mandal_config_admin_select + users_admin_select RLS): the
// full `Ledger`, including every user and the bank opening balance, for
// the aggregates (cashHeldByTreasurer, booksBalanceCheck) that need them —
// Task 15's master ledger. Cash-in-hand (Task 13) only ever needs
// fetchLedgerRows(), since volunteerCashInHand doesn't touch ledger.users.
export async function fetchFullLedger(): Promise<Ledger> {
  const [rows, usersRes, config] = await Promise.all([
    fetchLedgerRows(),
    supabase.from('users').select('id, role'),
    getMandalConfig(),
  ])
  if (usersRes.error) throw usersRes.error

  const users: LedgerUser[] = (usersRes.data ?? []).map((u) => ({
    id: u.id,
    role: u.role as LedgerUser['role'],
  }))

  return { ...rows, users, bankOpeningPaise: config.bank_opening_paise }
}
