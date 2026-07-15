// Typed query module for `expenses`. RLS (expenses_admin_* /
// expenses_volunteer_*, Task 2 migration) already scopes rows per-role
// server-side — admin sees/writes every row, a volunteer only rows where
// paid_by = app_user_id() — so a single plain `select *` (see getExpenses)
// returns the right rows for either caller with no client-side role
// branching. The append-only trigger (forbid_financial_edit) blocks editing
// category/amount_paise/description/paid_by/paid_from/created_at post-
// creation, but voided/void_reason/voided_by/voided_at aren't in that
// guarded list, so voidExpense's update is allowed through.
import { supabase } from './client'
import type { Tables } from './database.types'
import type { PaidFrom } from '../validation/expense'

// The join field is only ever populated by getExpenses (see below) — a
// plain createExpense insert doesn't select it, hence optional here rather
// than a second exported type.
export type Expense = Tables<'expenses'> & { paid_by_user?: { name: string } | null }

export type CreateExpenseInput = {
  category: string
  description: string
  amountPaise: number
  paidFrom: PaidFrom
  // Always the current session's acting user id (appUser.id from
  // useAuth()), never a value the form lets the user pick — same pattern
  // Task 7 established for collected_by on donations.
  paidBy: string
}

export async function createExpense(input: CreateExpenseInput): Promise<Expense> {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      category: input.category,
      description: input.description || null,
      amount_paise: input.amountPaise,
      paid_from: input.paidFrom,
      paid_by: input.paidBy,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// RLS scopes rows per-role automatically (see file header) — no
// `.eq('paid_by', ...)` here, that would be redundant client-side
// role-branching RLS already does server-side. The paid_by_user embed
// resolves the payer's display name in one query instead of a second
// users fetch + client-side id->name map; the fkey name disambiguates
// against expenses' other users FK (voided_by).
export async function getExpenses(): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*, paid_by_user:users!expenses_paid_by_fkey(name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function voidExpense(id: string, reason: string, voidedBy: string): Promise<void> {
  const { error } = await supabase
    .from('expenses')
    .update({
      voided: true,
      void_reason: reason,
      voided_by: voidedBy,
      voided_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}
