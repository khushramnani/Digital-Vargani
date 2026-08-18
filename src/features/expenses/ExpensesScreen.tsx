import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { createExpense, getExpenses, type Expense } from '../../lib/db/expenses'
import { getExpenseCategories, getMandal, updateMandal } from '../../lib/db/config'
import { voidRow } from '../../lib/db/void'
import { validateExpenseInput, type PaidFrom, type ExpenseValidationErrors } from '../../lib/validation/expense'
import { toPaise, formatINR, formatPct } from '../../lib/money'
import { strings } from '../../lib/strings'
import { isAdminRole } from '../../lib/roles'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Sheet } from '../../components/Sheet'
import { AppShell } from '../../components/AppShell'
import { Bar, Money, SearchField, SheetHeader, Switch } from '../../components/console'
import { HowToSheet } from '../admin/HowToSheet'
import { VolunteerTabBar } from '../collection/VolunteerTabBar'
import {
  choiceButton,
  consoleField,
  ctaDanger,
  ctaInk,
  ctaMuted,
  ctaOrange,
  ctaQuiet,
  errorText,
  eyebrow,
  eyebrowOnDark,
  hero,
  infoRoundOnDark,
  moneyHero,
  panel,
  panelTitle,
  pill,
  pillDashed,
} from '../../components/ui'

const t = strings.expenses

const PAID_FROM: PaidFrom[] = ['cash', 'bank']
const PAID_FROM_LABEL: Record<PaidFrom, string> = { cash: t.paidFromCash, bank: t.paidFromBank }
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--color-slot-${n})`)
// The expense hero splits by where the money came out of, not by category.
const CASH_COLOR = 'var(--color-slot-1)'
const BANK_COLOR = 'var(--color-slot-bank)'

// The design shows four category bars and folds the rest into one line.
const BARS = 4

type ESort = 'recent' | 'amount' | 'category'
const ESORTS: ESort[] = ['recent', 'amount', 'category']
const ESORT_LABEL: Record<ESort, string> = {
  recent: strings.collections.sortRecent,
  amount: strings.collections.sortAmount,
  category: t.categoryLabel,
}

const PAGE = 20

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

// Content-only body, reused behind /admin/expenses (inside AdminLayout's console
// frame) and /volunteer/expenses (inside the AppShell wrapper below) — RLS on
// `expenses` already scopes createExpense/getExpenses per-role server-side, so
// this body only branches on role where the DB genuinely does: managing the
// mandal's category list is an admin-only write (mandals_admin_update).
//
// Redesign 2026-08-18: the design's Expenses tab — a spend hero split by cash vs
// bank, spend-by-category bars that follow the filters, and the form itself in a
// sheet rather than sitting permanently above the list. Plan §3 also moves
// category management here from Mandal settings, so there is one place where
// categories are named and it is the place they are used.
export function ExpensesContent() {
  const { appUser } = useAuth()
  const [categories, setCategories] = useState<string[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [mandalId, setMandalId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [paidFrom, setPaidFrom] = useState('all')
  const [sort, setSort] = useState<ESort>('recent')
  const [showVoided, setShowVoided] = useState(false)
  const [page, setPage] = useState(1)

  const [sheet, setSheet] = useState<'form' | 'filters' | 'categories' | 'howto' | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [voidTarget, setVoidTarget] = useState<Expense | null>(null)
  const [busy, setBusy] = useState(false)

  const isAdmin = isAdminRole(appUser?.role ?? '')

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

  // Only an admin can write the category list, and only they need the mandal id
  // (updateMandal), so a volunteer never makes this admin-only request.
  useEffect(() => {
    if (!appUser || !isAdminRole(appUser.role)) return
    let active = true
    getMandal()
      .then((m) => {
        if (active) setMandalId(m.id)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [appUser])

  const q = search.trim().toLowerCase()
  const matches = useMemo(
    () => (e: Expense) =>
      (category === 'all' || e.category === category) &&
      (paidFrom === 'all' || e.paid_from === paidFrom) &&
      (q === '' ||
        e.category.toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q) ||
        (e.paid_by_user?.name ?? '').toLowerCase().includes(q)),
    [category, paidFrom, q],
  )

  const filtered = expenses.filter(matches)
  const voidedCount = filtered.filter((e) => e.voided).length
  const live = filtered.filter((e) => !e.voided)
  const listed = showVoided ? filtered : live
  const rows = [...listed].sort((a, b) =>
    sort === 'amount'
      ? b.amount_paise - a.amount_paise
      : sort === 'category'
        ? a.category.localeCompare(b.category)
        : 0,
  )

  const totalPaise = live.reduce((sum, e) => sum + e.amount_paise, 0)
  const cashPaise = live.filter((e) => e.paid_from === 'cash').reduce((sum, e) => sum + e.amount_paise, 0)
  const average = live.length ? Math.round(totalPaise / live.length) : 0

  // Spend by category follows whatever the filters say, so the bars always
  // describe the same money the total above them does.
  const byCategory = new Map<string, number>()
  for (const e of live) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount_paise)
  const catRows = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
  const restPaise = catRows.slice(BARS).reduce((sum, c) => sum + c[1], 0)

  const shown = Math.min(page * PAGE, rows.length)
  const selected = expenses.find((e) => e.id === selectedId) ?? null

  const chips: { label: string; clear: () => void }[] = []
  if (category !== 'all') chips.push({ label: category, clear: () => patch({ category: 'all' }) })
  if (paidFrom !== 'all')
    chips.push({ label: PAID_FROM_LABEL[paidFrom as PaidFrom], clear: () => patch({ paidFrom: 'all' }) })
  if (sort !== 'recent') chips.push({ label: ESORT_LABEL[sort], clear: () => patch({ sort: 'recent' }) })
  if (showVoided) chips.push({ label: t.inclVoidedChip, clear: () => patch({ showVoided: false }) })

  type Patch = { category?: string; paidFrom?: string; sort?: ESort; showVoided?: boolean; search?: string }
  function patch(p: Patch) {
    if (p.category !== undefined) setCategory(p.category)
    if (p.paidFrom !== undefined) setPaidFrom(p.paidFrom)
    if (p.sort !== undefined) setSort(p.sort)
    if (p.showVoided !== undefined) setShowVoided(p.showVoided)
    if (p.search !== undefined) setSearch(p.search)
    setPage(1)
  }

  async function reload() {
    setExpenses(await getExpenses())
  }

  async function handleCreate(input: {
    category: string
    description: string
    amountRupees: string
    paidFrom: PaidFrom | ''
  }) {
    if (!appUser) return
    setError(null)
    setNotice(null)
    await createExpense({
      category: input.category,
      description: input.description.trim(),
      amountPaise: toPaise(Number(input.amountRupees)),
      paidFrom: input.paidFrom as PaidFrom,
      // paidBy is never form-editable — it always comes from the session's
      // acting user, resolved at submit time.
      paidBy: appUser.id,
    })
    await reload()
    setSheet(null)
    setPage(1)
  }

  async function handleVoid(reason: string) {
    const id = voidTarget?.id
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      await voidRow('expenses', id, reason || strings.void.defaultReason)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setVoidTarget(null)
    }
  }

  return (
    <>
      <div className={hero}>
        <div className="flex items-baseline gap-2">
          <span className={eyebrowOnDark}>{t.totalSpentEyebrow}</span>
          <span className="flex-1" />
          <span className="text-[10.5px] font-semibold text-stone-500">
            {[category === 'all' ? t.allCategories : category, ...(paidFrom === 'all' ? [] : [PAID_FROM_LABEL[paidFrom as PaidFrom]])].join(' · ')}
          </span>
          <button
            type="button"
            onClick={() => setSheet('howto')}
            aria-label={strings.admin.howToEyebrow}
            className={`${infoRoundOnDark} -mt-0.5 h-[26px] w-[26px] text-xs`}
          >
            i
          </button>
        </div>
        <p className={`${moneyHero} mt-1 mb-0.5 text-orange-400`}>
          <Money paise={totalPaise} decClassName="text-[19px] opacity-60" />
        </p>
        <p className="text-[11.5px] font-medium text-stone-400">{t.summaryLine(live.length, formatINR(average))}</p>

        <div aria-hidden="true" className="mt-3 mb-2 flex h-[5px] overflow-hidden rounded-full bg-white/12">
          <span style={{ width: formatPct(cashPaise, totalPaise), backgroundColor: CASH_COLOR }} />
          <span style={{ width: formatPct(totalPaise - cashPaise, totalPaise), backgroundColor: BANK_COLOR }} />
        </div>
        <div className="flex gap-3.5 text-[10.5px] font-semibold text-stone-400">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: CASH_COLOR }} />
            {t.paidFromCash} {formatINR(cashPaise)}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: BANK_COLOR }} />
            {t.paidFromBank} {formatINR(totalPaise - cashPaise)}
          </span>
        </div>
      </div>

      <div className={panel}>
        <div className="mb-3 flex items-baseline justify-between gap-2.5">
          <h2 className={panelTitle}>{t.spendByCategoryTitle}</h2>
          <span className="text-[11px] font-semibold text-stone-400">{t.categoryCount(catRows.length)}</span>
        </div>
        {live.length === 0 ? (
          <p className="py-3.5 text-center text-xs font-medium text-stone-400">{t.noSpendMatch}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {catRows.slice(0, BARS).map(([name, paise], i) => (
              <div key={name}>
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{name}</span>
                  <span className="flex-none text-[11px] font-semibold text-stone-400">
                    {formatPct(paise, totalPaise)}
                  </span>
                  <Money
                    paise={paise}
                    className="min-w-[82px] flex-none text-right text-[13.5px] font-bold tabular-nums"
                  />
                </div>
                <Bar pct={formatPct(paise, totalPaise)} color={SLOTS[i % SLOTS.length]} height={5} className="mt-1.5" />
              </div>
            ))}
            {restPaise > 0 && (
              <div className="flex items-baseline gap-2 pt-0.5">
                <span className="flex-1 text-[13px] font-semibold text-stone-500">
                  {t.moreCategories(catRows.length - BARS)}
                </span>
                <Money paise={restPaise} className="text-[13px] font-bold tabular-nums text-stone-600" />
              </div>
            )}
          </div>
        )}
      </div>

      <button type="button" onClick={() => setSheet('form')} className={ctaInk}>
        {t.logAnExpense}
      </button>

      {/* Plan §3: one editing surface for the category list, on the tab where
          categories are actually used. Admin-only, because writing
          mandals.expense_categories is admin-only at the RLS level. */}
      {isAdmin && (
        <button type="button" onClick={() => setSheet('categories')} className={`${ctaQuiet} h-[38px] text-xs`}>
          {t.manageCategoriesToggle}
        </button>
      )}

      <div className="flex gap-[7px]">
        <SearchField value={search} onChange={(v) => patch({ search: v })} placeholder={t.searchPlaceholder} />
        <button
          type="button"
          onClick={() => setSheet('filters')}
          className={`h-10 flex-none rounded-xl border px-3.5 text-[12.5px] font-bold ${
            chips.length > 0 ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-700'
          }`}
        >
          {strings.collections.filtersButton}
          {chips.length > 0 ? ` · ${chips.length}` : ''}
        </button>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={c.clear}
              className="flex h-7 items-center gap-1.5 rounded-full bg-stone-900 px-2.5 text-[11.5px] font-semibold text-white"
            >
              {c.label}
              <span aria-hidden="true" className="opacity-55">
                ✕
              </span>
            </button>
          ))}
        </div>
      )}

      {notice && (
        <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-800">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : expenses.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
          {t.empty}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-stone-200 bg-stone-50 px-4 py-6 text-center">
          <p className="text-[13.5px] font-bold text-stone-600">{strings.collections.noResultsTitle}</p>
          <p className="mt-0.5 text-[11.5px] font-medium text-stone-400">{strings.collections.noResultsBody}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.slice(0, shown).map((e) => (
            <ExpenseRow key={e.id} expense={e} onOpen={() => setSelectedId(e.id)} />
          ))}
        </div>
      )}

      {rows.length > 0 &&
        (shown < rows.length ? (
          <div className="flex items-center gap-2.5">
            <span className="flex-1 text-[11.5px] font-semibold text-stone-400">
              {strings.collections.pagerShowing(shown, rows.length, t.expensesUnit(rows.length))}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              className="h-[38px] flex-none rounded-xl border border-stone-200 bg-white px-4 text-[12.5px] font-bold text-stone-700 transition-colors hover:border-stone-900"
            >
              {strings.app.loadMore}
            </button>
          </div>
        ) : (
          rows.length > PAGE && (
            <p className="text-center text-[11px] font-semibold text-faint">
              {strings.collections.pagerAll(rows.length, t.expensesUnit(rows.length))}
            </p>
          )
        ))}

      <ExpenseFormSheet
        open={sheet === 'form'}
        onClose={() => setSheet(null)}
        categories={categories}
        canAddCategory={isAdmin}
        onAddCategory={async (name) => {
          if (!mandalId) return
          const next = [...categories, name]
          await updateMandal(mandalId, { expense_categories: next })
          setCategories(next)
        }}
        onSubmit={handleCreate}
      />

      <EFiltersSheet
        open={sheet === 'filters'}
        onClose={() => setSheet(null)}
        categories={categories}
        category={category}
        paidFrom={paidFrom}
        sort={sort}
        showVoided={showVoided}
        voidedCount={voidedCount}
        resultLabel={t.expensesUnit(rows.length)}
        onChange={patch}
        onResetAll={() =>
          patch({ category: 'all', paidFrom: 'all', sort: 'recent', showVoided: false, search: '' })
        }
      />

      {isAdmin && (
        <CategoriesSheet
          open={sheet === 'categories'}
          onClose={() => setSheet(null)}
          categories={categories}
          mandalId={mandalId}
          onChange={(next) => {
            setCategories(next)
            setNotice(t.categoriesSaved)
          }}
        />
      )}

      <ExpenseDetailSheet
        expense={selected}
        onClose={() => setSelectedId(null)}
        onVoid={() => {
          setVoidTarget(selected)
          setSelectedId(null)
        }}
      />

      <HowToSheet tab="expenses" open={sheet === 'howto'} onClose={() => setSheet(null)} />

      <ConfirmDialog
        open={voidTarget !== null}
        title={t.voidThisExpense}
        body={strings.void.body}
        confirmLabel={t.voidButton}
        cancelLabel={strings.void.cancel}
        reason={{ label: t.voidPrompt, placeholder: strings.void.reasonPlaceholder }}
        onConfirm={(reason) => void handleVoid(reason)}
        onCancel={() => setVoidTarget(null)}
        busy={busy}
      />
    </>
  )
}

function ExpenseRow({ expense, onOpen }: { expense: Expense; onOpen: () => void }) {
  const dead = expense.voided
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`block w-full rounded-[16px] border p-[13px] text-left ${
        dead
          ? 'border-dashed border-stone-200 bg-stone-50'
          : 'border-stone-200 bg-white shadow-[0_1px_2px_rgba(28,25,23,.04)] transition-colors hover:border-stone-300'
      }`}
    >
      <span className="flex items-baseline gap-2.5">
        <span
          className={`min-w-0 flex-1 truncate text-sm font-bold ${dead ? 'text-stone-400 line-through' : 'text-stone-900'}`}
        >
          {expense.category}
        </span>
        <Money
          paise={expense.amount_paise}
          className={`flex-none text-[15px] font-bold tabular-nums ${dead ? 'text-faint line-through' : ''}`}
          decClassName={dead ? '' : 'text-stone-400'}
        />
      </span>
      {dead ? (
        <span className="mt-1 block text-[11.5px] font-medium text-faint">
          {t.voidedPrefix}
          {expense.void_reason}
        </span>
      ) : (
        <>
          <span className="mt-0.5 block truncate text-[12.5px] font-medium text-stone-600">
            {expense.description || t.noNote}
          </span>
          <span className="mt-1.5 block text-[11px] font-medium text-stone-400">
            {t.paidByAndFrom(expense.paid_by_user?.name ?? t.unknownUser, PAID_FROM_LABEL[expense.paid_from as PaidFrom])}
          </span>
        </>
      )}
    </button>
  )
}

// The expense form, in a sheet. Deliberately no edit mode even though the mockup
// has one: forbid_financial_edit() refuses an UPDATE on a recorded expense, so a
// wrong figure is a void plus a re-entry — the same rule donations follow.
function ExpenseFormSheet({
  open,
  onClose,
  categories,
  canAddCategory,
  onAddCategory,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  categories: string[]
  canAddCategory: boolean
  onAddCategory: (name: string) => Promise<void>
  onSubmit: (input: {
    category: string
    description: string
    amountRupees: string
    paidFrom: PaidFrom | ''
  }) => Promise<void>
}) {
  if (!open) return null
  return (
    <Sheet open onClose={onClose} labelledBy="expense-form-title">
      <ExpenseFormBody
        onClose={onClose}
        categories={categories}
        canAddCategory={canAddCategory}
        onAddCategory={onAddCategory}
        onSubmit={onSubmit}
      />
    </Sheet>
  )
}

function ExpenseFormBody({
  onClose,
  categories,
  canAddCategory,
  onAddCategory,
  onSubmit,
}: {
  onClose: () => void
  categories: string[]
  canAddCategory: boolean
  onAddCategory: (name: string) => Promise<void>
  onSubmit: (input: {
    category: string
    description: string
    amountRupees: string
    paidFrom: PaidFrom | ''
  }) => Promise<void>
}) {
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [amountRupees, setAmountRupees] = useState('')
  const [paidFrom, setPaidFrom] = useState<PaidFrom | ''>('')
  const [errors, setErrors] = useState<ExpenseValidationErrors>({})
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    const result = validateExpenseInput({ category, description, amountRupees, paidFrom }, categories)
    setErrors(result.errors)
    if (!result.valid) return
    setSubmitting(true)
    try {
      await onSubmit({ category, description, amountRupees, paidFrom })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function addCategory() {
    const name = newCat.trim()
    if (name === '') return
    if (categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setError(t.categoryDuplicateError)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await onAddCategory(name)
      setCategory(name)
      setNewCat('')
      setNewCatOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const canSave = category !== '' && Number(amountRupees) > 0 && paidFrom !== ''

  return (
    <>
      <SheetHeader
        title={t.formTitleAdd}
        titleId="expense-form-title"
        hint={t.formHintAdd}
        onClose={onClose}
        closeLabel={strings.app.close}
      />

      <p className={`${eyebrow} mt-[18px] mb-2`}>{t.categoryLabel}</p>
      <div role="group" aria-label={t.categoryLabel} className="flex flex-wrap gap-[7px]">
        {categories.map((c) => (
          <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={pill(category === c)}>
            {c}
          </button>
        ))}
        {/* Adding a category writes mandals.expense_categories, which is
            admin-only at the RLS level — so a volunteer is not offered a button
            whose request the server would refuse. */}
        {canAddCategory && (
          <button type="button" onClick={() => setNewCatOpen((o) => !o)} className={pillDashed}>
            ＋ {t.newCategoryChip}
          </button>
        )}
      </div>
      {errors.category && (
        <p role="alert" className={`mt-1.5 ${errorText}`}>
          {errors.category}
        </p>
      )}

      {newCatOpen && (
        <>
          <div className="mt-2.5 flex gap-[7px]">
            <input
              value={newCat}
              aria-label={t.newCategoryPlaceholder}
              placeholder={t.newCategoryPlaceholder}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void addCategory()
                }
              }}
              className={`${consoleField} h-10 flex-1 border-stone-900 font-semibold`}
            />
            <button
              type="button"
              onClick={() => void addCategory()}
              disabled={submitting}
              className="h-10 flex-none rounded-xl bg-stone-900 px-4 text-[12.5px] font-bold text-white disabled:opacity-50"
            >
              {t.addCategory}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-stone-400">{t.newCategorySavedHint}</p>
        </>
      )}

      <label htmlFor="expense-description" className={`${eyebrow} mt-[18px] mb-2 block`}>
        {t.whatWasItFor}
      </label>
      <input
        id="expense-description"
        value={description}
        placeholder={t.descriptionPlaceholder}
        onChange={(e) => setDescription(e.target.value)}
        className={consoleField}
      />

      <label htmlFor="expense-amount" className={`${eyebrow} mt-4 mb-2 block`}>
        {t.amountLabel}
      </label>
      <div className="flex h-[58px] items-center rounded-[14px] border-[1.5px] border-stone-200 bg-white px-3.5 focus-within:border-orange-500">
        <span aria-hidden="true" className="font-display text-2xl font-extrabold text-stone-900">
          ₹
        </span>
        <input
          id="expense-amount"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={amountRupees}
          placeholder="0"
          onChange={(e) => setAmountRupees(e.target.value)}
          className="font-display ml-[7px] min-w-0 flex-1 bg-transparent text-2xl font-extrabold tabular-nums text-stone-900 outline-none placeholder:text-stone-300"
        />
      </div>
      {errors.amountRupees && (
        <p role="alert" className={`mt-1.5 ${errorText}`}>
          {errors.amountRupees}
        </p>
      )}

      <p className={`${eyebrow} mt-4 mb-2`}>{t.paidFromLabel}</p>
      <div role="group" aria-label={t.paidFromLabel} className="flex gap-2">
        {PAID_FROM.map((from) => (
          <button
            key={from}
            type="button"
            aria-pressed={paidFrom === from}
            onClick={() => setPaidFrom(from)}
            className={choiceButton(paidFrom === from)}
          >
            {PAID_FROM_LABEL[from]}
          </button>
        ))}
      </div>
      {errors.paidFrom && (
        <p role="alert" className={`mt-1.5 ${errorText}`}>
          {errors.paidFrom}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting || !canSave}
        className={`mt-[18px] ${canSave && !submitting ? ctaOrange : ctaMuted}`}
      >
        {submitting ? t.submitting : t.submitButton}
      </button>
      <p className="mt-2 text-center text-[11px] leading-relaxed font-medium text-stone-400 text-pretty">
        {strings.app.onlineOnlyHint}
      </p>
      {error && (
        <p role="alert" className={`mt-2 ${errorText}`}>
          {error}
        </p>
      )}
    </>
  )
}

function ExpenseDetailSheet({
  expense,
  onClose,
  onVoid,
}: {
  expense: Expense | null
  onClose: () => void
  onVoid: () => void
}) {
  if (!expense) return null
  return (
    <Sheet open onClose={onClose} labelledBy="expense-detail-title">
      <SheetHeader
        title={expense.category}
        titleId="expense-detail-title"
        hint={`${shortDate(expense.created_at)} · ${PAID_FROM_LABEL[expense.paid_from as PaidFrom]}`}
        onClose={onClose}
        closeLabel={strings.app.close}
      />

      <p className="font-display mt-3 mb-1 text-[34px] font-extrabold tracking-[-0.03em] tabular-nums">
        <Money paise={expense.amount_paise} decClassName="text-[19px] text-stone-400" />
      </p>
      <p className="text-[12.5px] font-medium text-stone-600">{expense.description || t.noNote}</p>
      <p className="mt-1 text-[11.5px] font-medium text-stone-400">
        {t.paidByPrefix}
        {expense.paid_by_user?.name ?? t.unknownUser}
      </p>

      {expense.voided ? (
        <p className="mt-4 rounded-xl border border-dashed border-stone-200 bg-stone-50 px-[13px] py-3 text-xs font-semibold text-stone-500">
          {t.voidedPrefix}
          {expense.void_reason}
        </p>
      ) : (
        <>
          <button type="button" onClick={onVoid} className={`mt-4 ${ctaDanger}`}>
            {t.voidThisExpense}
          </button>
          <p className="mt-1.5 text-center text-[10.5px] font-medium text-faint">{t.voidFootnote}</p>
        </>
      )}
    </Sheet>
  )
}

// Plan §3: the category list, edited where it is used. Same draft-then-save shape
// as the donation-sources sheet, and the same append-only promise — removing a
// category never touches a past expense.
function CategoriesSheet({
  open,
  onClose,
  categories,
  mandalId,
  onChange,
}: {
  open: boolean
  onClose: () => void
  categories: string[]
  mandalId: string | null
  onChange: (categories: string[]) => void
}) {
  if (!open) return null
  return (
    <Sheet open onClose={onClose} labelledBy="categories-sheet-title">
      <CategoriesSheetBody onClose={onClose} categories={categories} mandalId={mandalId} onChange={onChange} />
    </Sheet>
  )
}

function CategoriesSheetBody({
  onClose,
  categories,
  mandalId,
  onChange,
}: {
  onClose: () => void
  categories: string[]
  mandalId: string | null
  onChange: (categories: string[]) => void
}) {
  const [draft, setDraft] = useState<string[]>(categories)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const dirty = draft.length !== categories.length || draft.some((c, i) => c !== categories[i])

  function add() {
    const name = newName.trim()
    if (name === '') return
    if (draft.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setError(t.categoryDuplicateError)
      return
    }
    setError(null)
    setDraft([...draft, name])
    setNewName('')
  }

  async function save() {
    if (!dirty || !mandalId) return
    const cleaned = draft.map((c) => c.trim()).filter((c) => c !== '')
    setBusy(true)
    setError(null)
    try {
      await updateMandal(mandalId, { expense_categories: cleaned })
      onChange(cleaned)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader
        title={t.manageCategoriesTitle}
        titleId="categories-sheet-title"
        hint={t.manageCategoriesHint}
        onClose={onClose}
        closeLabel={strings.app.close}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        {draft.map((c) => (
          <span
            key={c}
            className="flex items-center gap-1.5 rounded-full bg-stone-100 py-1 pr-2 pl-3 text-[13px] font-semibold text-stone-700"
          >
            {c}
            <button
              type="button"
              aria-label={`${t.removeCategory}: ${c}`}
              onClick={() => setDraft(draft.filter((x) => x !== c))}
              className="flex h-4 w-4 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-200 hover:text-red-600"
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={newName}
          aria-label={t.addCategoryPlaceholder}
          placeholder={t.addCategoryPlaceholder}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          className={`${consoleField} h-11 flex-1 border-dashed border-stone-300 font-semibold`}
        />
        <button
          type="button"
          onClick={add}
          className="h-11 flex-none rounded-xl bg-stone-900 px-4 text-[12.5px] font-bold text-white"
        >
          {t.addCategory}
        </button>
      </div>

      {error && (
        <p role="alert" className={`mt-2 ${errorText}`}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={dirty ? () => void save() : onClose}
        disabled={busy}
        className={`mt-4 ${dirty ? ctaOrange : ctaQuiet}`}
      >
        {busy ? strings.mandalConfig.saving : dirty ? strings.app.save : strings.app.done}
      </button>
    </>
  )
}

function EFiltersSheet({
  open,
  onClose,
  categories,
  category,
  paidFrom,
  sort,
  showVoided,
  voidedCount,
  resultLabel,
  onChange,
  onResetAll,
}: {
  open: boolean
  onClose: () => void
  categories: string[]
  category: string
  paidFrom: string
  sort: ESort
  showVoided: boolean
  voidedCount: number
  resultLabel: string
  onChange: (patch: { category?: string; paidFrom?: string; sort?: ESort; showVoided?: boolean }) => void
  onResetAll: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="efilters-sheet-title">
      <div className="flex items-center gap-2.5">
        <h2
          id="efilters-sheet-title"
          className="font-display flex-1 text-lg font-extrabold tracking-[-0.02em] text-stone-900"
        >
          {strings.collections.filterSheetTitle}
        </h2>
        <button type="button" onClick={onClose} aria-label={strings.app.close} className="text-stone-500">
          ✕
        </button>
      </div>

      <p className={`${eyebrow} mt-[18px] mb-2`}>{t.categoryLabel}</p>
      <div role="group" aria-label={t.categoryLabel} className="flex flex-wrap gap-[7px]">
        <button type="button" aria-pressed={category === 'all'} onClick={() => onChange({ category: 'all' })} className={pill(category === 'all')}>
          {strings.app.all}
        </button>
        {categories.map((c) => (
          <button key={c} type="button" aria-pressed={category === c} onClick={() => onChange({ category: c })} className={pill(category === c)}>
            {c}
          </button>
        ))}
      </div>

      <p className={`${eyebrow} mt-4 mb-2`}>{t.paidFromLabel}</p>
      <div role="group" aria-label={t.paidFromLabel} className="flex flex-wrap gap-[7px]">
        <button type="button" aria-pressed={paidFrom === 'all'} onClick={() => onChange({ paidFrom: 'all' })} className={pill(paidFrom === 'all')}>
          {strings.app.all}
        </button>
        {PAID_FROM.map((from) => (
          <button key={from} type="button" aria-pressed={paidFrom === from} onClick={() => onChange({ paidFrom: from })} className={pill(paidFrom === from)}>
            {PAID_FROM_LABEL[from]}
          </button>
        ))}
      </div>

      <p className={`${eyebrow} mt-4 mb-2`}>{strings.collections.groupSort}</p>
      <div role="group" aria-label={strings.collections.groupSort} className="flex flex-wrap gap-[7px]">
        {ESORTS.map((s) => (
          <button key={s} type="button" aria-pressed={sort === s} onClick={() => onChange({ sort: s })} className={pill(sort === s)}>
            {ESORT_LABEL[s]}
          </button>
        ))}
      </div>

      {(voidedCount > 0 || showVoided) && (
        <button
          type="button"
          aria-pressed={showVoided}
          onClick={() => onChange({ showVoided: !showVoided })}
          className="mt-[18px] flex w-full items-center gap-[11px] rounded-[14px] border border-hairline bg-stone-50 px-[13px] py-3 text-left"
        >
          <span className="flex-1">
            <span className="block text-[13px] font-bold text-stone-800">{t.showVoidedTitle}</span>
            <span className="mt-px block text-[11px] font-medium text-stone-400">{t.showVoidedHint}</span>
          </span>
          <Switch on={showVoided} />
        </button>
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onResetAll} className={`${ctaQuiet} w-auto flex-none px-4`}>
          {strings.app.reset}
        </button>
        <button type="button" onClick={onClose} className={`${ctaInk} h-[46px] flex-1`}>
          {strings.collections.showResults(resultLabel)}
        </button>
      </div>
    </Sheet>
  )
}

// Volunteer wrapper (/volunteer/expenses) — AppShell + bottom tab bar. The admin
// route renders ExpensesContent bare inside AdminLayout instead.
export function ExpensesScreen() {
  const { appUser } = useAuth()
  const isAdmin = isAdminRole(appUser?.role ?? '')
  const isVolunteer = appUser?.role === 'volunteer'
  const home = isAdmin
    ? { to: '/admin', label: strings.admin.dashboardTitle }
    : { to: '/collect', label: strings.collection.title }

  return (
    <AppShell title={t.title} back={home}>
      <div className="flex flex-col gap-3">
        <ExpensesContent />
      </div>
      {isVolunteer && (
        <>
          <div aria-hidden="true" className="h-16" />
          <VolunteerTabBar />
        </>
      )}
    </AppShell>
  )
}
