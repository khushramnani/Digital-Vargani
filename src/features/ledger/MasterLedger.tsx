import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchFullLedger } from '../../lib/db/ledger'
import { totalCollected, totalExpenses, netBalance, booksBalanceCheck, type Ledger } from '../../lib/reconcile'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { AppShell } from '../../components/AppShell'
import { card } from '../../components/ui'

const t = strings.ledger
const a = strings.admin

// Emoji live here (route + icon are structure, not copy); the labels and
// descriptions come from strings.admin so the operator UI stays translatable
// in one place.
const NAV: { to: string; icon: string; label: string; desc: string }[] = [
  { to: '/collect', icon: '🪔', label: a.collectDonationLink, desc: a.descriptions.collect },
  { to: '/admin/collections', icon: '🧾', label: a.collectionsLink, desc: a.descriptions.collections },
  { to: '/admin/expenses', icon: '💸', label: a.expensesLink, desc: a.descriptions.expenses },
  { to: '/admin/handovers', icon: '🤝', label: a.handoversLink, desc: a.descriptions.handovers },
  { to: '/admin/cash-in-hand', icon: '💰', label: a.cashInHandLink, desc: a.descriptions.cashInHand },
  { to: '/admin/volunteers', icon: '🧑‍🤝‍🧑', label: a.volunteersLink, desc: a.descriptions.volunteers },
  { to: '/admin/admins', icon: '🛡️', label: a.adminsLink, desc: a.descriptions.admins },
  { to: '/admin/transparency', icon: '🪷', label: a.transparencyLink, desc: a.descriptions.transparency },
  { to: '/admin/settings', icon: '⚙️', label: a.settingsLink, desc: a.descriptions.settings },
]

function StatTile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'balance' }) {
  return (
    <div className={`${card} p-4`}>
      <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'balance' ? 'text-orange-700' : 'text-stone-900'}`}>
        {value}
      </p>
    </div>
  )
}

// Task 15: the real content for the admin dashboard stub Task 4 left in
// place of AdminDashboardPage (see src/app/router.tsx) — routed at "/admin".
// fetchFullLedger() is admin-only (mandals_admin_select +
// users_admin_select RLS), which is exactly the scope this screen needs —
// and both are mandal-scoped, so it only ever sums this mandal's books.
export function MasterLedgerScreen() {
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchFullLedger()
      .then((data) => {
        if (active) setLedger(data)
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

  const books = ledger ? booksBalanceCheck(ledger) : null

  return (
    <AppShell title={a.dashboardTitle} subtitle={a.dashboardSubtitle}>
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <StatSkeleton />
      ) : (
        ledger && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile label={t.totalCollectedLabel} value={formatINR(totalCollected(ledger))} />
              <StatTile label={t.totalExpensesLabel} value={formatINR(totalExpenses(ledger))} />
              <StatTile label={t.netBalanceLabel} value={formatINR(netBalance(ledger))} tone="balance" />
            </div>

            {books && (
              <div
                role="status"
                className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                  books.balanced
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {books.balanced ? `✓ ${t.balanced}` : `✗ ${t.discrepancyPrefix}${formatINR(books.discrepancyPaise)}`}
              </div>
            )}
          </>
        )
      )}

      <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`group flex items-center gap-3.5 ${card} p-4 transition-all hover:border-orange-300 hover:shadow-md`}
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
    </AppShell>
  )
}

function StatSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${card} p-4`}>
          <div className="h-3 w-24 animate-pulse rounded bg-stone-200" />
          <div className="mt-2 h-7 w-20 animate-pulse rounded bg-stone-200" />
        </div>
      ))}
    </div>
  )
}
