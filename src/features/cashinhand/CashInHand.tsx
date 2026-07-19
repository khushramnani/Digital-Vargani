import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { fetchLedgerRows, fetchActiveVolunteers } from '../../lib/db/ledger'
import { getHandovers, type Handover } from '../../lib/db/handovers'
import { volunteerCashInHand, type Ledger } from '../../lib/reconcile'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { AppShell } from '../../components/AppShell'
import { VolunteerTabBar } from '../collection/VolunteerTabBar'
import { card, btnPrimaryLg, errorText } from '../../components/ui'

const t = strings.cashInHand

type Row = { id: string; name: string; amountPaise: number }
type VolunteerView = {
  owed: number
  collected: number
  spent: number
  handed: number
  handovers: Handover[]
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// Content-only body, reused behind /admin/cash-in-hand (inside AdminLayout's
// console frame) and /volunteer/cash-in-hand (inside the AppShell wrapper
// below). The two roles see genuinely different shapes — a volunteer sees their
// own "you owe the treasurer" hero + breakdown, an admin sees the per-volunteer
// list — so the body branches on appUser.role. fetchLedgerRows() is RLS-scoped
// (a volunteer's select only returns their own rows), so volunteerCashInHand is
// correct even without a real users/bankOpeningPaise — it never reads those
// fields (see lib/reconcile.ts).
export function CashInHandContent() {
  const { appUser } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [vol, setVol] = useState<VolunteerView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!appUser) return
    let active = true

    async function load() {
      const rowsForLedger = await fetchLedgerRows()
      const ledger: Ledger = { ...rowsForLedger, users: [], bankOpeningPaise: 0 }

      if (appUser!.role === 'admin') {
        const volunteers = await fetchActiveVolunteers()
        setRows(volunteers.map((v) => ({ id: v.id, name: v.name, amountPaise: volunteerCashInHand(v.id, ledger) })))
        return
      }

      const uid = appUser!.id
      const handovers = await getHandovers() // RLS-scoped to this volunteer's own rows
      const sum = <T,>(items: T[], pred: (x: T) => boolean, amt: (x: T) => number) =>
        items.filter(pred).reduce((s, x) => s + amt(x), 0)
      setVol({
        owed: volunteerCashInHand(uid, ledger),
        collected: sum(ledger.donations, (d) => d.mode === 'cash' && d.collectedBy === uid && !d.voided, (d) => d.amountPaise),
        spent: sum(ledger.expenses, (e) => e.paidFrom === 'cash' && e.paidBy === uid && !e.voided, (e) => e.amountPaise),
        handed: sum(ledger.handovers, (h) => h.volunteerId === uid && !h.voided, (h) => h.amountPaise),
        handovers: handovers.filter((h) => !h.voided),
      })
    }

    load()
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

  const isVolunteer = appUser?.role === 'volunteer'

  // Only surface the breakdown stats that carry information — a fresh
  // volunteer who's only collected sees just the hero (collected == owed, so a
  // duplicate card would add nothing). Shown once anything's been spent/handed.
  const statCards: { label: string; paise: number }[] = []
  if (vol && (vol.spent > 0 || vol.handed > 0)) statCards.push({ label: t.cashCollectedLabel, paise: vol.collected })
  if (vol && vol.spent > 0) statCards.push({ label: t.spentOnMandalLabel, paise: vol.spent })
  if (vol && vol.handed > 0) statCards.push({ label: t.handedOverLabel, paise: vol.handed })

  return (
    <>
      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : isVolunteer && vol ? (
        <>
          {/* The emotional core: a deep-maroon "you owe the treasurer" hero.
              The owed figure is volunteerCashInHand — the exact number the
              handover/void e2e specs assert drops by the handed/voided amount. */}
          <div className="rounded-2xl bg-[#7a2e2a] p-6 text-white shadow-sm">
            <p className="text-xs font-semibold tracking-wide text-red-200/90 uppercase">{t.youOweLabel}</p>
            <p className="mt-1 text-4xl font-bold tabular-nums">{formatINR(vol.owed)}</p>
            <p className="mt-1 text-sm text-red-100/80">{vol.owed > 0 ? t.youOweSubtitle : t.allSettled}</p>
          </div>

          {statCards.length > 0 && (
            <div className="flex gap-2.5">
              {statCards.map((c) => (
                <div key={c.label} className={`flex-1 ${card} p-3.5`}>
                  <p className="text-[11px] font-semibold tracking-wide text-stone-400 uppercase">{c.label}</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-stone-900">{formatINR(c.paise)}</p>
                </div>
              ))}
            </div>
          )}

          {vol.owed > 0 && (
            <Link to="/volunteer/handover" className={`${btnPrimaryLg} block text-center`}>
              {t.handToTreasurerCta}
            </Link>
          )}

          {vol.handovers.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <h2 className="text-xs font-bold tracking-wide text-stone-400 uppercase">{t.myHandoversTitle}</h2>
              <ul className="flex flex-col gap-2.5">
                {vol.handovers.map((h) => (
                  <li key={h.id} className={`flex items-center justify-between gap-3 ${card} p-4`}>
                    <div className="min-w-0">
                      <p className="font-semibold text-stone-900">
                        {strings.handovers.receivedByPrefix}
                        {h.received_by_user?.name ?? strings.handovers.unknownUser}
                      </p>
                      <p className="text-[13px] text-stone-500">{shortDate(h.created_at)}</p>
                    </div>
                    <span className="flex-none font-bold tabular-nums text-stone-900">{formatINR(h.amount_paise)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
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

    </>
  )
}

// Volunteer wrapper (/volunteer/cash-in-hand) — AppShell + bottom tab bar. The
// admin route renders CashInHandContent bare inside AdminLayout instead.
export function CashInHandScreen() {
  const { appUser } = useAuth()
  const isAdmin = appUser?.role === 'admin'
  const isVolunteer = appUser?.role === 'volunteer'
  const home = isAdmin
    ? { to: '/admin', label: strings.admin.dashboardTitle }
    : { to: '/collect', label: strings.collection.title }

  return (
    <AppShell title={t.title} back={home}>
      <CashInHandContent />
      {isVolunteer && (
        <>
          <div aria-hidden="true" className="h-16" />
          <VolunteerTabBar />
        </>
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
