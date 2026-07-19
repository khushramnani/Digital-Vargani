import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
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
import { supabase } from '../../lib/db/client'
import { card } from '../../components/ui'
import { FundDonut, type DonutSegment } from '../../components/FundDonut'

const t = strings.ledger
const a = strings.admin

// Emoji live here (route + icon are structure, not copy); labels/descriptions
// come from strings.admin so the operator UI stays translatable in one place.
type NavItem = { to: string; icon: string; label: string; desc: string }

const NAV: NavItem[] = [
  { to: '/admin', icon: '📊', label: a.dashboardTitle, desc: a.dashboardSubtitle },
  { to: '/collect', icon: '🪔', label: a.collectDonationLink, desc: a.descriptions.collect },
  { to: '/admin/collections', icon: '🧾', label: a.collectionsLink, desc: a.descriptions.collections },
  { to: '/admin/expenses', icon: '💸', label: a.expensesLink, desc: a.descriptions.expenses },
  { to: '/admin/handovers', icon: '🤝', label: a.handoversLink, desc: a.descriptions.handovers },
  { to: '/admin/cash-in-hand', icon: '💰', label: a.cashInHandLink, desc: a.descriptions.cashInHand },
  { to: '/admin/volunteers', icon: '🧑‍🤝‍🧑', label: a.volunteersLink, desc: a.descriptions.volunteers },
  { to: '/admin/admins', icon: '🛡️', label: a.adminsLink, desc: a.descriptions.admins },
  { to: '/admin/transparency', icon: '🪷', label: a.transparencyLink, desc: a.descriptions.transparency },
]
// Settings pins to the bottom of the console rail, apart from the main list.
const SETTINGS: NavItem = { to: '/admin/settings', icon: '⚙️', label: a.settingsLink, desc: a.descriptions.settings }
// "Collect donation" stays the one prominent action in the rail (design F9).
const PROMINENT = '/collect'

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

// Task 15: the real content for the admin dashboard — routed at "/admin".
// fetchFullLedger()/fetchActiveVolunteers()/getExpenses() are all admin-only at
// the RLS level and mandal-scoped, so this only ever sums this mandal's books.
export function MasterLedgerScreen() {
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
    <div className="min-h-screen bg-stone-50 font-body text-stone-900 lg:flex">
      <Sidebar />

      <div className="min-w-0 flex-1">
        <MobileTopBar />

        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 lg:px-8">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-stone-900">{t.masterLedgerTitle}</h1>
            <p className="text-[15px] text-stone-500">{t.liveSubtitle}</p>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {error}
            </p>
          )}

          {loading ? <DashboardSkeleton /> : ledger && <Dashboard ledger={ledger} volunteers={volunteers} expenses={expenses} />}

          {/* Phone nav: the light card grid collapses in below the ledger; the
              dark rail is desktop-only. All destinations stay reachable on both. */}
          <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
            {[...NAV, SETTINGS].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`group flex items-center gap-3.5 ${card} p-4 transition-all hover:border-orange-300 hover:shadow-md ${
                  item.to === PROMINENT ? 'border-orange-300 bg-orange-50' : ''
                }`}
              >
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-amber-50 text-xl transition-colors group-hover:bg-amber-100">
                  {item.icon}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-stone-900">{item.label}</span>
                  <span className="block truncate text-[13px] text-stone-500">{item.desc}</span>
                </span>
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
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
      <EquationBanner books={books} net={netBalance(ledger)} volunteers={volunteersTotal} treasurer={treasurerCash} bank={bank} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CashTracker ledger={ledger} volunteers={volunteers} />
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
// ponytail: the 3-term equation reads exactly when bankOpening = 0 (the app
// default and the design's example); with an opening balance the reconcile
// identity folds it into the Bank term, so left/right differ by exactly the
// opening balance. The ✓/✗ verdict itself comes from booksBalanceCheck, which
// uses the full identity (opening balance included) — so the verdict is always
// honest even where the shorthand equation's arithmetic is offset.
function EquationBanner({
  books,
  net,
  volunteers,
  treasurer,
  bank,
}: {
  books: BooksBalanceResult
  net: number
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
}: {
  label: string
  value: string
  sub: string
  valueClass?: string
  dark?: boolean
}) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${dark ? 'border-stone-900 bg-stone-900' : 'border-stone-200 bg-white'}`}>
      <p className={`text-xs font-semibold tracking-wide uppercase ${dark ? 'text-stone-400' : 'text-stone-500'}`}>{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${dark ? 'text-white' : valueClass}`}>{value}</p>
      <p className={`mt-0.5 text-xs ${dark ? 'text-stone-400' : 'text-stone-500'}`}>{sub}</p>
    </div>
  )
}

// Per active-volunteer cash-in-hand rows. Names come from fetchActiveVolunteers
// (the Ledger only carries ids); every rupee figure comes from the ledger.
function CashTracker({ ledger, volunteers }: { ledger: Ledger; volunteers: VolunteerSummary[] }) {
  const rows = volunteers.map((v) => {
    const inHand = volunteerCashInHand(v.id, ledger)
    const collected = ledger.donations
      .filter((d) => d.mode === 'cash' && d.collectedBy === v.id && !d.voided)
      .reduce((sum, d) => sum + d.amountPaise, 0)
    const handed = ledger.handovers.filter((h) => h.volunteerId === v.id && !h.voided).reduce((sum, h) => sum + h.amountPaise, 0)
    return { id: v.id, name: v.name, inHand, collected, handed }
  })
  const withVolunteers = rows.reduce((sum, r) => sum + Math.max(0, r.inHand), 0)

  return (
    <div className={`${card} p-5`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-stone-900">{t.cashTrackerTitle}</h2>
        <span className="text-sm tabular-nums text-stone-700">
          <span className="font-bold">{formatINR(withVolunteers)}</span>
          <span className="font-medium text-stone-400">{t.withVolunteersSuffix}</span>
        </span>
      </div>

      {rows.length === 0 ? (
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
        </ul>
      )}
    </div>
  )
}

// Dark treasurer-console rail — desktop only; the phone gets the card grid.
function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 flex-none flex-col gap-6 bg-stone-900 px-4 py-6 text-stone-200 lg:flex">
      <div className="flex items-center gap-2.5 px-1">
        <div className="font-mark flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-lg font-extrabold text-stone-900 shadow-md shadow-orange-600/30">
          ॥
        </div>
        <div className="leading-tight">
          <div className="font-display text-[15px] font-extrabold tracking-tight text-white">{strings.landing.productName}</div>
          <div className="text-[9px] font-semibold tracking-widest text-stone-500 uppercase">{t.consoleTitle}</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => (
          <SideLink key={item.to} item={item} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 border-t border-stone-800 pt-3">
        <SideLink item={SETTINGS} />
        <button
          type="button"
          onClick={() => void supabase.auth.signOut()}
          className="rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-stone-400 transition-colors hover:bg-stone-800 hover:text-white"
        >
          {strings.app.signOut}
        </button>
      </div>
    </aside>
  )
}

function SideLink({ item }: { item: NavItem }) {
  const prominent = item.to === PROMINENT
  return (
    <Link
      to={item.to}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
        prominent ? 'bg-orange-600 text-white hover:bg-orange-500' : 'text-stone-300 hover:bg-stone-800 hover:text-white'
      }`}
    >
      <span className="flex-none text-lg">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

// The phone frame's top bar (brand + sign-out) — the desktop rail carries both,
// so this is hidden on lg+.
function MobileTopBar() {
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/85 backdrop-blur lg:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <Link to="/admin" className="inline-flex items-center gap-2.5">
          <div className="font-mark flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-lg font-extrabold text-stone-900 shadow-md shadow-orange-600/30">
            ॥
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-extrabold tracking-tight">{strings.landing.productName}</div>
            <div className="text-[9px] font-semibold tracking-widest text-stone-400 uppercase">{t.consoleTitle}</div>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => void supabase.auth.signOut()}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-stone-800"
        >
          {strings.app.signOut}
        </button>
      </div>
    </header>
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
