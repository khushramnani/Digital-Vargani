// Pure client-side mirror of the DB CHECK constraints on `expenses`
// (amount_paise > 0, paid_from in ('cash','bank')) plus a data-quality check
// that category is one of the mandal's configured expense_categories (not
// itself DB-enforced, just required here) — for immediate form feedback
// only, the DB still enforces amount/paid_from regardless. Kept
// framework-free so it's trivially unit-testable without mounting
// ExpensesScreen, same pattern as validation/donation.ts.
import { strings } from '../strings'

export type PaidFrom = 'cash' | 'bank'

const PAID_FROM_VALUES: PaidFrom[] = ['cash', 'bank']

export type ExpenseFormInput = {
  category: string
  description: string
  amountRupees: string
  paidFrom: PaidFrom | ''
}

export type ExpenseValidationErrors = Partial<Record<'category' | 'amountRupees' | 'paidFrom', string>>

const t = strings.expenses.errors

// `categories` is the mandal's currently configured expense_categories
// (from getMandalConfig) — passed in rather than fetched here so this stays
// a pure function, same as donation validation takes no I/O of its own.
export function validateExpenseInput(
  input: ExpenseFormInput,
  categories: string[],
): { valid: boolean; errors: ExpenseValidationErrors } {
  const errors: ExpenseValidationErrors = {}

  if (!input.category.trim() || !categories.includes(input.category)) {
    errors.category = t.category
  }

  const amount = Number(input.amountRupees)
  if (!input.amountRupees.trim() || !Number.isFinite(amount) || amount <= 0) {
    errors.amountRupees = t.amountRupees
  }

  if (!PAID_FROM_VALUES.includes(input.paidFrom as PaidFrom)) {
    errors.paidFrom = t.paidFrom
  }

  return { valid: Object.keys(errors).length === 0, errors }
}
