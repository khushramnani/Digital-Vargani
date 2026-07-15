import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { createExpense, getExpenses, type Expense } from '../../lib/db/expenses'
import { getMandalConfig } from '../../lib/db/config'
import { voidRow } from '../../lib/db/void'
import { validateExpenseInput, type PaidFrom, type ExpenseValidationErrors } from '../../lib/validation/expense'
import { toPaise, formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { VoidButton } from '../../components/VoidButton'

const t = strings.expenses

const PAID_FROM_OPTIONS: { value: PaidFrom; label: string }[] = [
  { value: 'cash', label: t.paidFromCash },
  { value: 'bank', label: t.paidFromBank },
]

// One screen, reused behind both /volunteer/expenses (RequireRole
// role="volunteer") and /admin/expenses (RequireRole role="admin") — RLS on
// `expenses` already scopes createExpense/getExpenses per-role server-side
// (see src/lib/db/expenses.ts), so this component never branches on role.
export function ExpensesScreen() {
  const { appUser } = useAuth()
  const [categories, setCategories] = useState<string[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [amountRupees, setAmountRupees] = useState('')
  const [paidFrom, setPaidFrom] = useState<PaidFrom | ''>('')
  const [errors, setErrors] = useState<ExpenseValidationErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([getMandalConfig(), getExpenses()])
      .then(([config, expenseRows]) => {
        if (!active) return
        setCategories(config.expense_categories)
        setExpenses(expenseRows)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const result = validateExpenseInput({ category, description, amountRupees, paidFrom }, categories)
    setErrors(result.errors)
    // paidBy is never form-editable — it always comes from the session's
    // acting user, resolved once here at submit time.
    if (!result.valid || !appUser) return

    setSubmitting(true)
    try {
      await createExpense({
        category,
        description: description.trim(),
        amountPaise: toPaise(Number(amountRupees)),
        paidFrom: paidFrom as PaidFrom,
        paidBy: appUser.id,
      })
      setExpenses(await getExpenses())
      setCategory('')
      setDescription('')
      setAmountRupees('')
      setPaidFrom('')
      setErrors({})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVoid(expense: Expense, reason: string) {
    if (!appUser) return
    try {
      await voidRow('expenses', expense.id, reason, appUser.id)
      setExpenses(await getExpenses())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold text-stone-900">{t.title}</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded border border-stone-300 p-4">
        <label htmlFor="expense-category" className="text-sm text-stone-600">
          {t.categoryLabel}
        </label>
        <select
          id="expense-category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="rounded border border-stone-300 px-3 py-3 text-lg"
        >
          <option value="">{t.categoryPlaceholder}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {errors.category && (
          <p role="alert" className="text-sm text-red-700">
            {errors.category}
          </p>
        )}

        <label htmlFor="expense-description" className="text-sm text-stone-600">
          {t.descriptionLabel}
        </label>
        <input
          id="expense-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="rounded border border-stone-300 px-3 py-3 text-lg"
        />

        <label htmlFor="expense-amount" className="text-sm text-stone-600">
          {t.amountLabel}
        </label>
        <input
          id="expense-amount"
          type="number"
          step="0.01"
          min="0"
          value={amountRupees}
          onChange={(event) => setAmountRupees(event.target.value)}
          className="rounded border border-stone-300 px-3 py-3 text-lg"
        />
        {errors.amountRupees && (
          <p role="alert" className="text-sm text-red-700">
            {errors.amountRupees}
          </p>
        )}

        <span className="text-sm text-stone-600">{t.paidFromLabel}</span>
        <div role="group" aria-label={t.paidFromLabel} className="grid grid-cols-2 gap-2">
          {PAID_FROM_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={paidFrom === option.value}
              onClick={() => setPaidFrom(option.value)}
              className={`rounded border px-3 py-6 text-lg font-medium ${
                paidFrom === option.value
                  ? 'border-orange-700 bg-orange-700 text-white'
                  : 'border-stone-300 text-stone-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {errors.paidFrom && (
          <p role="alert" className="text-sm text-red-700">
            {errors.paidFrom}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-orange-700 px-3 py-4 text-lg text-white disabled:opacity-50"
        >
          {submitting ? t.submitting : t.submitButton}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </form>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : expenses.length === 0 ? (
        <p className="text-stone-400">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {expenses.map((expense) => (
            <li key={expense.id} className="rounded border border-stone-200 p-3">
              <div className={`flex items-center justify-between ${expense.voided ? 'text-stone-400 line-through' : ''}`}>
                <span className="font-medium text-stone-900">{expense.category}</span>
                <span>{formatINR(expense.amount_paise)}</span>
              </div>
              {expense.description && (
                <p className={`text-sm text-stone-600 ${expense.voided ? 'line-through' : ''}`}>{expense.description}</p>
              )}
              <p className="text-sm text-stone-400">
                {t.paidByPrefix}
                {expense.paid_by_user?.name ?? t.unknownUser} ·{' '}
                {expense.paid_from === 'cash' ? t.paidFromCash : t.paidFromBank}
              </p>
              {expense.voided ? (
                <p className="text-sm text-red-700">
                  {t.voidedPrefix}
                  {expense.void_reason}
                </p>
              ) : (
                <VoidButton label={t.voidButton} prompt={t.voidPrompt} onVoid={(reason) => handleVoid(expense, reason)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
