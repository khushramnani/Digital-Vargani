import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { getDonations, type Donation } from '../../lib/db/donations'
import { voidRow } from '../../lib/db/void'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { VoidButton } from '../../components/VoidButton'

const t = strings.collections

// SPEC.md's "my collections" (volunteer) / "all collections" (admin)
// screen — every donation, not just the not-yet-sent subset PendingSend
// shows. One screen, reused behind both /volunteer/collections (RequireRole
// role="volunteer") and /admin/collections (RequireRole role="admin") — RLS
// on `donations` already scopes getDonations per-role server-side (see
// src/lib/db/donations.ts), same pattern as ExpensesScreen/HandoverScreen.
// This is also where a donation (any donation, not just unsent ones — that
// case is PendingSend's) can be voided, closing the gap Task 14 left: it
// only wired void into the not-yet-sent subset.
export function CollectionsScreen() {
  const { appUser } = useAuth()
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function load() {
    return getDonations().then(setDonations)
  }

  useEffect(() => {
    let active = true
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
  }, [])

  async function handleVoid(donation: Donation, reason: string) {
    if (!appUser) return
    try {
      await voidRow('donations', donation.id, reason, appUser.id)
      setDonations(await getDonations())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

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
      ) : donations.length === 0 ? (
        <p className="text-stone-400">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {donations.map((donation) => (
            <li key={donation.id} className="rounded border border-stone-200 p-3">
              <div className={`flex items-center justify-between ${donation.voided ? 'text-stone-400 line-through' : ''}`}>
                <span className="font-medium text-stone-900">{donation.donor_name}</span>
                <span>{formatINR(donation.amount_paise)}</span>
              </div>
              <p className={`text-sm text-stone-600 ${donation.voided ? 'line-through' : ''}`}>
                {t.receiptPrefix}
                {donation.receipt_no} · {donation.mode}
              </p>
              {donation.voided ? (
                <p className="text-sm text-red-700">
                  {t.voidedPrefix}
                  {donation.void_reason}
                </p>
              ) : (
                <VoidButton label={t.voidButton} prompt={t.voidPrompt} onVoid={(reason) => handleVoid(donation, reason)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
