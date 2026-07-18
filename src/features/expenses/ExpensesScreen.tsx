import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { createExpense, getExpenses, type Expense } from '../../lib/db/expenses'
import { getExpenseCategories } from '../../lib/db/config'
import { voidRow } from '../../lib/db/void'
import { validateExpenseInput, type PaidFrom, type ExpenseValidationErrors } from '../../lib/validation/expense'
import { toPaise, formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { VoidButton } from '../../components/VoidButton'
import { AppShell } from '../../components/AppShell'
import { card, fieldLg, label as labelCls, btnPrimaryLg, errorText } from '../../components/ui'

const t = strings.expenses

const PAID_FROM_OPTIONS: { value: PaidFrom; label: string }[] = [
  { value: 'cash', label: t.paidFromCash },
  { value: 'bank', label: t.paidFromBank },
]

// One screen, reused behind both /volunteer/expenses (RequireRole
// role="volunteer") and /admin/expenses (RequireRole role="admin") — RLS on
// `expenses` already scopes createExpense/getExpenses per-role server-side
// (see src/lib/db/expenses.ts), so this component never branches on role.
// Categories come from getExpenseCategories() (the get_expense_categories
// RPC), not getMandal() directly — mandals' RLS is admin-only, which would
// otherwise 0-row a volunteer session here.
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
    Promise.all([getExpenseCategories(), getExpenses()])
      .then(([categoryList, expenseRows]) => {
        if (!active) return
        setCategories(categoryList)
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
      await voidRow('expenses', expense.id, reason)
      setExpenses(await getExpenses())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const isAdmin = appUser?.role === 'admin'
  const home = isAdmin
    ? { to: '/admin', label: strings.admin.dashboardTitle }
    : { to: '/collect', label: strings.collection.title }

  return (
    <AppShell title={t.title} back={home}>
      <form onSubmit={handleSubmit} className={`flex flex-col gap-4 ${card} p-5`}>
        <div className="flex flex-col gap-2">
          <label htmlFor="expense-category" className={labelCls}>
            {t.categoryLabel}
          </label>
          <select
            id="expense-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className={fieldLg}
          >
            <option value="">{t.categoryPlaceholder}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {errors.category && (
            <p role="alert" className={errorText}>
              {errors.category}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="expense-description" className={labelCls}>
            {t.descriptionLabel}
          </label>
          <input
            id="expense-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={fieldLg}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="expense-amount" className={labelCls}>
            {t.amountLabel}
          </label>
          <input
            id="expense-amount"
            type="number"
            step="0.01"
            min="0"
            value={amountRupees}
            onChange={(event) => setAmountRupees(event.target.value)}
            className={fieldLg}
          />
          {errors.amountRupees && (
            <p role="alert" className={errorText}>
              {errors.amountRupees}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className={labelCls}>{t.paidFromLabel}</span>
          <div role="group" aria-label={t.paidFromLabel} className="grid grid-cols-2 gap-2.5">
            {PAID_FROM_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={paidFrom === option.value}
                onClick={() => setPaidFrom(option.value)}
                className={`rounded-xl border px-3 py-5 text-lg font-semibold transition-colors ${
                  paidFrom === option.value
                    ? 'border-orange-600 bg-orange-600 text-white shadow-md shadow-orange-600/25'
                    : 'border-stone-300 bg-white text-stone-700 hover:border-stone-400'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {errors.paidFrom && (
            <p role="alert" className={errorText}>
              {errors.paidFrom}
            </p>
          )}
        </div>

        <button type="submit" disabled={submitting} className={btnPrimaryLg}>
          {submitting ? t.submitting : t.submitButton}
        </button>
        <p className="text-center text-xs text-stone-400">{strings.app.onlineOnlyHint}</p>
        {error && (
          <p role="alert" className={errorText}>
            {error}
          </p>
        )}
      </form>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : expenses.length === 0 ? (
        <EmptyState message={t.empty} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {expenses.map((expense) => (
            <li key={expense.id} className={`${card} p-4`}>
              <div className={`flex items-center justify-between gap-3 ${expense.voided ? 'text-stone-400' : ''}`}>
                <span className={`font-semibold ${expense.voided ? 'text-stone-400 line-through' : 'text-stone-900'}`}>
                  {expense.category}
                </span>
                <span className={`flex-none font-bold tabular-nums ${expense.voided ? 'line-through' : 'text-stone-900'}`}>
                  {formatINR(expense.amount_paise)}
                </span>
              </div>
              {expense.description && (
                <p className={`mt-0.5 text-sm text-stone-600 ${expense.voided ? 'line-through' : ''}`}>
                  {expense.description}
                </p>
              )}
              <p className="mt-1 text-[13px] text-stone-400">
                {t.paidByPrefix}
                {expense.paid_by_user?.name ?? t.unknownUser} ·{' '}
                {expense.paid_from === 'cash' ? t.paidFromCash : t.paidFromBank}
              </p>
              {expense.voided ? (
                <p className="mt-1 text-[13px] text-stone-400">
                  {t.voidedPrefix}
                  {expense.void_reason}
                </p>
              ) : (
                <div className="mt-1 flex justify-end">
                  <VoidButton label={t.voidButton} prompt={t.voidPrompt} onVoid={(reason) => handleVoid(expense, reason)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
      {message}
    </div>
  )
}
