import { useEffect, useState, type ReactNode } from 'react'
import { fetchFullLedger, fetchActiveVolunteers, type VolunteerSummary } from '../../lib/db/ledger'
import { getExpenses, type Expense } from '../../lib/db/expenses'
import {
  totalCollected,
  totalExpenses,
  netBalance,
  booksBalanceCheck,
  volunteerCashInHand,
  cashHeldByTreasurer,
  bankBalance,
  type Ledger,
  type BooksBalanceResult,
} from '../../lib/reconcile'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { card } from '../../components/ui'
import { FundDonut, type DonutSegment } from '../../components/FundDonut'

const t = strings.ledger

// Same warm festival palette as the transparency donut so the two pies read as
// one system. Slots assigned by rank (largest first), a 9th+ category folds
// into "Other" rather than growing the palette.
// ponytail: no colourblind-validator run — the donut is decorative and every
// slice is also a text+amount legend row (FundDonut), so colour is never the
// only channel; ≤8 expense categories is the realistic ceiling for one mandal.
const CATEGORY_COLORS = ['#e2680f', '#2f7d44', '#dca02c', '#c0442e', '#7c4a86', '#2f8a86', '#c96b93', '#8a6d3b']
const OTHER_COLOR = '#a8998a'

// The Ledger drops the expense category (reconcile.ts only needs amount/mode),
// so the "where the money went" pie is built from the admin-scoped getExpenses
// rows instead — same RLS scope as the ledger, just carrying the category.
function toExpenseSegments(expenses: Expense[]): DonutSegment[] {
  const byCategory = new Map<string, number>()
  for (const e of expenses) {
    if (e.voided) continue
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount_paise)
  }
  const sorted = [...byCategory.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((x, y) => y.value - x.value)
  const head = sorted.slice(0, CATEGORY_COLORS.length)
  const rest = sorted.slice(CATEGORY_COLORS.length)
  const segments: DonutSegment[] = head.map((c, i) => ({ name: c.name, value: c.value, color: CATEGORY_COLORS[i] }))
  const otherTotal = rest.reduce((sum, c) => sum + c.value, 0)
  if (otherTotal > 0) segments.push({ name: strings.transparency.otherCategory, value: otherTotal, color: OTHER_COLOR })
  return segments
}

// The admin dashboard body — routed at "/admin" inside AdminLayout's <Outlet/>,
// which supplies the console frame (dark rail / mobile pill header + title).
// fetchFullLedger()/fetchActiveVolunteers()/getExpenses() are all admin-only at
// the RLS level and mandal-scoped, so this only ever sums this mandal's books.
export function MasterLedgerContent() {
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [volunteers, setVolunteers] = useState<VolunteerSummary[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([fetchFullLedger(), fetchActiveVolunteers(), getExpenses()])
      .then(([l, v, e]) => {
        if (!active) return
        setLedger(l)
        setVolunteers(v)
        setExpenses(e)
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

  return (
    <>
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? <DashboardSkeleton /> : ledger && <Dashboard ledger={ledger} volunteers={volunteers} expenses={expenses} />}
    </>
  )
}

function Dashboard({ ledger, volunteers, expenses }: { ledger: Ledger; volunteers: VolunteerSummary[]; expenses: Expense[] }) {
  const donationCount = ledger.donations.filter((d) => !d.voided).length
  const paymentCount = ledger.expenses.filter((e) => !e.voided).length

  const books = booksBalanceCheck(ledger)
  const volunteersTotal = ledger.users
    .filter((u) => u.role === 'volunteer')
    .reduce((sum, u) => sum + volunteerCashInHand(u.id, ledger), 0)
  const treasurerCash = cashHeldByTreasurer(ledger)
  const bank = bankBalance(ledger)

  return (
    <>
      <EquationBanner
        books={books}
        net={netBalance(ledger)}
        opening={ledger.bankOpeningPaise}
        volunteers={volunteersTotal}
        treasurer={treasurerCash}
        bank={bank}
      />

      {/* Mobile: 2×2 grid whose 4th tile is "Cash w/ volunteers" (design v3).
          Desktop: the trio in a row (the 4th tile is hidden). */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label={t.fundPoolLabel}
          value={formatINR(totalCollected(ledger))}
          valueClass="text-emerald-700"
          sub={`${donationCount}${t.donationsCountSuffix}`}
        />
        <StatCard
          label={t.totalExpensesLabel}
          value={formatINR(totalExpenses(ledger))}
          valueClass="text-orange-600"
          sub={`${paymentCount}${t.paymentsCountSuffix}`}
        />
        <StatCard label={t.netBalanceLabel} value={formatINR(netBalance(ledger))} sub={t.netBalanceSubtitle} dark />
        <StatCard
          label={t.cashWithVolunteersLabel}
          value={formatINR(volunteersTotal)}
          valueClass="text-[#7a2e2a]"
          className="lg:hidden"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CashTracker ledger={ledger} volunteers={volunteers} volunteersTotal={volunteersTotal} />
        <div className={`${card} p-5`}>
          <h2 className="font-display text-lg font-bold text-stone-900">{t.whereMoneyWentTitle}</h2>
          <div className="mt-5">
            {(() => {
              const segments = toExpenseSegments(expenses)
              return segments.length === 0 ? (
                <p className="py-6 text-center text-sm text-stone-400">{t.noExpensesYet}</p>
              ) : (
                <FundDonut segments={segments} />
              )
            })()}
          </div>
        </div>
      </div>
    </>
  )
}

// Books-balance equation banner (design F9): the real reconcile components in
// words, so the treasurer sees what "balanced" means — and a red state stays
// debuggable via the same equation plus the signed discrepancy.
// The identity booksBalanceCheck enforces is
//   Volunteers + Treasurer cash + Bank = Net Balance + Bank opening,
// so the banner puts Net (+ opening, when non-zero) on the left and the three
// buckets on the right — the printed arithmetic always closes, at any opening
// balance, matching the ✓/✗ verdict exactly.
function EquationBanner({
  books,
  net,
  opening,
  volunteers,
  treasurer,
  bank,
}: {
  books: BooksBalanceResult
  net: number
  opening: number
  volunteers: number
  treasurer: number
  bank: number
}) {
  const ok = books.balanced
  return (
    <div
      role="status"
      className={`rounded-2xl border px-5 py-4 ${ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-sm font-bold text-white ${
            ok ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          {ok ? '✓' : '✗'}
        </span>
        <p className={`font-bold ${ok ? 'text-green-800' : 'text-red-800'}`}>
          {ok ? t.booksBalanceTitle : t.booksImbalanceTitle}
        </p>
      </div>
      <p
        className={`mt-2.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm tabular-nums ${
          ok ? 'text-green-900/80' : 'text-red-900/80'
        }`}
      >
        <span>
          <span className="font-semibold">{t.equationNetLabel}</span> {formatINR(net)}
        </span>
        {opening !== 0 && (
          <>
            <span className="text-stone-400">+</span>
            <span>
              {t.equationOpeningLabel} <span className="font-semibold">{formatINR(opening)}</span>
            </span>
          </>
        )}
        <span className="text-stone-400">=</span>
        <span>
          {t.equationVolunteers} <span className="font-semibold">{formatINR(volunteers)}</span>
        </span>
        <span className="text-stone-400">+</span>
        <span>
          {t.equationTreasurer} <span className="font-semibold">{formatINR(treasurer)}</span>
        </span>
        <span className="text-stone-400">+</span>
        <span>
          {t.equationBank} <span className="font-semibold">{formatINR(bank)}</span>
        </span>
      </p>
      {!ok && (
        <p className="mt-1.5 text-xs font-semibold text-red-700">
          {t.discrepancyPrefix}
          {formatINR(books.discrepancyPaise)}
        </p>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  valueClass = 'text-stone-900',
  dark = false,
  className = '',
}: {
  label: string
  value: string
  sub?: string
  valueClass?: string
  dark?: boolean
  className?: string
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${dark ? 'border-stone-900 bg-stone-900' : 'border-stone-200 bg-white'} ${className}`}
    >
      <p className={`text-xs font-semibold tracking-wide uppercase ${dark ? 'text-stone-400' : 'text-stone-500'}`}>{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${dark ? 'text-white' : valueClass}`}>{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${dark ? 'text-stone-400' : 'text-stone-500'}`}>{sub}</p>}
    </div>
  )
}

// Per-volunteer cash-in-hand rows. Names come from fetchActiveVolunteers (the
// Ledger only carries ids); every rupee figure comes from the ledger. The
// header total is `volunteersTotal` — the SAME figure the equation banner's
// "Volunteers" term uses (Σ volunteerCashInHand over every volunteer-role user,
// signed) — so the two never disagree. A deactivated volunteer who still holds
// collected cash is absent from `volunteers` (active-only) but present in that
// sum, so any remainder they hold is surfaced as an "Inactive volunteers" row
// rather than silently vanishing from the breakdown.
function CashTracker({
  ledger,
  volunteers,
  volunteersTotal,
}: {
  ledger: Ledger
  volunteers: VolunteerSummary[]
  volunteersTotal: number
}) {
  const rows = volunteers.map((v) => {
    const inHand = volunteerCashInHand(v.id, ledger)
    const collected = ledger.donations
      .filter((d) => d.mode === 'cash' && d.collectedBy === v.id && !d.voided)
      .reduce((sum, d) => sum + d.amountPaise, 0)
    const handed = ledger.handovers.filter((h) => h.volunteerId === v.id && !h.voided).reduce((sum, h) => sum + h.amountPaise, 0)
    return { id: v.id, name: v.name, inHand, collected, handed }
  })
  // Whatever the active rows don't account for is held by volunteers no longer
  // in the active list — show it so no cash is invisible.
  const accountedActive = rows.reduce((sum, r) => sum + r.inHand, 0)
  const inactiveRemainder = volunteersTotal - accountedActive

  return (
    <div className={`${card} p-5`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-stone-900">{t.cashTrackerTitle}</h2>
        <span className="text-sm tabular-nums text-stone-700">
          <span className="font-bold">{formatINR(volunteersTotal)}</span>
          <span className="font-medium text-stone-400">{t.withVolunteersSuffix}</span>
        </span>
      </div>

      {rows.length === 0 && inactiveRemainder === 0 ? (
        <p className="py-6 text-center text-sm text-stone-400">{strings.cashInHand.empty}</p>
      ) : (
        <ul className="mt-3">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 border-t border-stone-100 py-3 first:border-0">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-800">
                {r.name.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-stone-900">{r.name}</p>
                <p className="text-xs tabular-nums text-stone-500">
                  {t.collectedPrefix}
                  {formatINR(r.collected)} · {t.handedPrefix}
                  {formatINR(r.handed)}
                </p>
              </div>
              <div className="flex-none text-right">
                <p className="font-bold tabular-nums text-stone-900">{formatINR(r.inHand)}</p>
                {r.inHand > 0 && <p className="text-[11px] font-semibold text-orange-600">{t.stillOwesLabel}</p>}
              </div>
            </li>
          ))}
          {inactiveRemainder !== 0 && (
            <li className="flex items-center gap-3 border-t border-stone-100 py-3 first:border-0">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-stone-100 text-sm font-bold text-stone-500">
                …
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-stone-500">{t.inactiveVolunteersLabel}</p>
              </div>
              <div className="flex-none text-right">
                <p className="font-bold tabular-nums text-stone-900">{formatINR(inactiveRemainder)}</p>
                {inactiveRemainder > 0 && <p className="text-[11px] font-semibold text-orange-600">{t.stillOwesLabel}</p>}
              </div>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function DashboardSkeleton(): ReactNode {
  return (
    <>
      <div className={`${card} h-20 animate-pulse`} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${card} p-4`}>
            <div className="h-3 w-24 animate-pulse rounded bg-stone-200" />
            <div className="mt-2 h-7 w-20 animate-pulse rounded bg-stone-200" />
          </div>
        ))}
      </div>
    </>
  )
}
