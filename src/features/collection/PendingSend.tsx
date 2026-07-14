import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { getPendingSendDonations, type Donation } from '../../lib/db/donations'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { sendReceiptSms } from './send'

const t = strings.pendingSend

// Routed behind RequireRole role="volunteer" (see src/app/router.tsx), at
// /volunteer/pending. Lists the current volunteer's own donations that
// haven't had an SMS sent yet (sms_sent_at IS NULL), most recent first —
// the Task 8 brief's "Pending send" tray. "Send" reuses send.ts's
// sendReceiptSms — the exact same flow CollectionForm's auto-send/
// fallback button uses, so a retry here can't drift out of sync with it.
export function PendingSend() {
  const { appUser } = useAuth()
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!appUser) return
    let active = true
    getPendingSendDonations(appUser.id)
      .then((data) => {
        if (active) setDonations(data)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [appUser])

  function handleSend(donation: Donation) {
    sendReceiptSms(donation)
    setSentIds((current) => new Set(current).add(donation.id))
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-stone-900">{t.title}</h1>
        <Link to="/volunteer" className="text-sm text-orange-700 underline">
          {t.backLink}
        </Link>
      </div>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : donations.length === 0 ? (
        <p className="text-stone-400">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {donations.map((donation) => (
            <li
              key={donation.id}
              className="flex items-center justify-between rounded border border-stone-200 p-3"
            >
              <div>
                <p className="font-medium text-stone-900">{donation.donor_name}</p>
                <p className="text-sm text-stone-600">{formatINR(donation.amount_paise)}</p>
              </div>
              <button
                type="button"
                onClick={() => handleSend(donation)}
                className="rounded border border-orange-700 px-3 py-2 text-orange-700"
              >
                {sentIds.has(donation.id) ? t.sent : t.sendButton}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
