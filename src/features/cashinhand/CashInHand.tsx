import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { fetchLedgerRows, fetchActiveVolunteers } from '../../lib/db/ledger'
import { volunteerCashInHand, type Ledger } from '../../lib/reconcile'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'

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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold text-stone-900">{t.title}</h1>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : appUser?.role === 'volunteer' ? (
        <p className="text-3xl font-semibold text-stone-900">{formatINR(rows[0]?.amountPaise ?? 0)}</p>
      ) : rows.length === 0 ? (
        <p className="text-stone-400">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between rounded border border-stone-200 p-3">
              <span className="font-medium text-stone-900">{row.name}</span>
              <span>{formatINR(row.amountPaise)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
