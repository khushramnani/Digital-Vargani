import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { fetchLedgerRows, fetchActiveVolunteers } from '../../lib/db/ledger'
import { volunteerCashInHand, type Ledger } from '../../lib/reconcile'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { AppShell } from '../../components/AppShell'
import { card, errorText } from '../../components/ui'

const t = strings.cashInHand

type Row = { id: string; name: string; amountPaise: number }

// Routed behind RequireRole role="volunteer" at /volunteer/cash-in-hand and
// role="admin" at /admin/cash-in-hand. Unlike ExpensesScreen/HandoverScreen
// (one query works for either role via RLS), the two roles see genuinely
// different shapes here — one number vs. a per-volunteer breakdown — so
// this branches on appUser.role instead of reusing a single query.
// fetchLedgerRows() is itself RLS-scoped (a volunteer's select only ever
// returns their own donations/expenses/handovers), so volunteerCashInHand
// is correct for a volunteer even without a real `users`/bankOpeningPaise
// — it never reads those fields (see lib/reconcile.ts).
export function CashInHandScreen() {
  const { appUser } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!appUser) return
    let active = true

    async function load(): Promise<Row[]> {
      const rowsForLedger = await fetchLedgerRows()
      const ledger: Ledger = { ...rowsForLedger, users: [], bankOpeningPaise: 0 }

      if (appUser!.role === 'admin') {
        const volunteers = await fetchActiveVolunteers()
        return volunteers.map((v) => ({ id: v.id, name: v.name, amountPaise: volunteerCashInHand(v.id, ledger) }))
      }
      return [{ id: appUser!.id, name: appUser!.name, amountPaise: volunteerCashInHand(appUser!.id, ledger) }]
    }

    load()
      .then((result) => {
        if (active) setRows(result)
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
  }, [appUser])

  const isAdmin = appUser?.role === 'admin'
  const home = isAdmin
    ? { to: '/admin', label: strings.admin.dashboardTitle }
    : { to: '/volunteer', label: strings.collection.title }

  return (
    <AppShell title={t.title} back={home}>
      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : appUser?.role === 'volunteer' ? (
        // A volunteer sees only their own single figure — give it the weight
        // of a headline number, not a list row.
        <div className={`${card} p-6`}>
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{t.title}</p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-stone-900">
            {formatINR(rows[0]?.amountPaise ?? 0)}
          </p>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState message={t.empty} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <li key={row.id} className={`flex items-center justify-between gap-3 ${card} p-4`}>
              <span className="font-semibold text-stone-900">{row.name}</span>
              <span className="flex-none font-bold tabular-nums text-stone-900">{formatINR(row.amountPaise)}</span>
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
