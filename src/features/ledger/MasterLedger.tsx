import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchFullLedger } from '../../lib/db/ledger'
import { totalCollected, totalExpenses, netBalance, booksBalanceCheck, type Ledger } from '../../lib/reconcile'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'

const t = strings.ledger

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-stone-200 p-4">
      <p className="text-sm text-stone-500">{label}</p>
      <p className="text-2xl font-semibold text-stone-900">{value}</p>
    </div>
  )
}

// Task 15: the real content for the admin dashboard stub Task 4 left in
// place of AdminDashboardPage (see src/app/router.tsx) — routed at "/admin".
// fetchFullLedger() is admin-only (mandal_config_admin_select +
// users_admin_select RLS), which is exactly the scope this screen needs.
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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold text-stone-900">{strings.admin.dashboardTitle}</h1>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : (
        ledger && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile label={t.totalCollectedLabel} value={formatINR(totalCollected(ledger))} />
              <StatTile label={t.totalExpensesLabel} value={formatINR(totalExpenses(ledger))} />
              <StatTile label={t.netBalanceLabel} value={formatINR(netBalance(ledger))} />
            </div>

            {books && (
              <div
                role="status"
                className={`rounded border p-4 text-sm font-medium ${
                  books.balanced ? 'border-green-700 text-green-700' : 'border-red-700 text-red-700'
                }`}
              >
                {books.balanced ? `✓ ${t.balanced}` : `✗ ${t.discrepancyPrefix}${formatINR(books.discrepancyPaise)}`}
              </div>
            )}
          </>
        )
      )}

      <div className="flex flex-col gap-2">
        <Link to="/volunteer" className="text-orange-700 underline">
          {strings.admin.collectDonationLink}
        </Link>
        <Link to="/admin/collections" className="text-orange-700 underline">
          {strings.admin.collectionsLink}
        </Link>
        <Link to="/admin/volunteers" className="text-orange-700 underline">
          {strings.admin.volunteersLink}
        </Link>
        <Link to="/admin/settings" className="text-orange-700 underline">
          {strings.admin.settingsLink}
        </Link>
        <Link to="/admin/expenses" className="text-orange-700 underline">
          {strings.admin.expensesLink}
        </Link>
        <Link to="/admin/handovers" className="text-orange-700 underline">
          {strings.admin.handoversLink}
        </Link>
        <Link to="/admin/cash-in-hand" className="text-orange-700 underline">
          {strings.admin.cashInHandLink}
        </Link>
        <Link to="/admin/transparency" className="text-orange-700 underline">
          {strings.admin.transparencyLink}
        </Link>
      </div>
    </main>
  )
}
