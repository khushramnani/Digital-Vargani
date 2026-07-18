import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { getPendingSendDonations, type Donation } from '../../lib/db/donations'
import { voidRow } from '../../lib/db/void'
import { db, type OutboxDonation } from '../../lib/queue/db'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { sendReceiptSms, sendReceiptWhatsApp } from './send'
import { LanguagePicker } from './LanguagePicker'
import { useReceiptLang } from './useReceiptLang'
import { VoidButton } from '../../components/VoidButton'
import { AppShell } from '../../components/AppShell'
import { card, btnGhost } from '../../components/ui'

const t = strings.pendingSend

// Routed behind RequireRole role="volunteer" (see src/app/router.tsx), at
// /volunteer/pending. Lists the current volunteer's own donations that
// haven't had an SMS sent yet (sms_sent_at IS NULL), most recent first —
// the Task 8 brief's "Pending send" tray. "Send" reuses send.ts's
// sendReceiptSms — the exact same flow CollectionForm's auto-send/
// fallback button uses, so a retry here can't drift out of sync with it.
// Task 10 adds a second, separate list above it: this volunteer's own
// still-queued (not yet synced) Dexie outbox items, with no Send button —
// there's no public_token to send until the row has actually synced.
export function PendingSend() {
  const { appUser } = useAuth()
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [queuedItems, setQueuedItems] = useState<OutboxDonation[]>([])
  // Its own picker, preset the same way: an offline donation arrives here
  // with no collection-time language (threading it through the Dexie outbox
  // is the rejected stored-per-donation design), so it defaults to the
  // mandal's language unless re-picked here.
  const [lang, setLang] = useReceiptLang()

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

  useEffect(() => {
    if (!appUser) return
    const collectedBy = appUser.id
    let active = true
    function refetchQueued() {
      db.outbox
        .orderBy('queuedAt')
        .toArray()
        .then((items) => {
          if (active) setQueuedItems(items.filter((item) => item.collectedBy === collectedBy))
        })
        .catch(() => {})
    }
    refetchQueued()
    // sync.ts dispatches this after any successful sync (normal or
    // idempotency-recovery) — the custom-event mechanism the brief uses in
    // place of a dexie-react-hooks live query, so this tray drops a synced
    // item off its "waiting for signal" list without a page reload.
    window.addEventListener('queue:changed', refetchQueued)
    return () => {
      active = false
      window.removeEventListener('queue:changed', refetchQueued)
    }
  }, [appUser])

  function handleSendSms(donation: Donation) {
    sendReceiptSms(donation, lang)
    setSentIds((current) => new Set(current).add(donation.id))
  }

  function handleSendWhatsApp(donation: Donation) {
    sendReceiptWhatsApp(donation, lang)
    setSentIds((current) => new Set(current).add(donation.id))
  }

  // Task 14: voiding here (the volunteer's own not-yet-sent donations)
  // is the one existing donations list this shared void flow has to wire
  // into — there's no dedicated "my collections" screen in the numbered
  // task list yet.
  async function handleVoid(donation: Donation, reason: string) {
    if (!appUser) return
    await voidRow('donations', donation.id, reason, appUser.id)
    setDonations(await getPendingSendDonations(appUser.id))
  }

  return (
    <AppShell title={t.title} back={{ to: '/volunteer', label: strings.collection.title }}>
      <LanguagePicker lang={lang} onChange={setLang} label={strings.collection.languageLabel} />

      {/* Rendered independently of `loading` (which only tracks the
          server-fetched list below) — this is a local, near-instant Dexie
          read, so a volunteer with no signal still sees their own queued
          entries immediately instead of waiting behind a server fetch
          that may never resolve while offline. */}
      {queuedItems.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {queuedItems.map((item) => (
            <li
              key={item.localId}
              className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-stone-300 bg-white p-4"
            >
              <div className="min-w-0">
                <p className="font-semibold text-stone-900">{item.donorName}</p>
                <p className="text-sm text-stone-500">{formatINR(item.amountPaise)}</p>
              </div>
              <span className="flex-none rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                {t.waitingForSignal}
              </span>
            </li>
          ))}
        </ul>
      )}

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : donations.length === 0 ? (
        queuedItems.length === 0 && (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
            {t.empty}
          </div>
        )
      ) : (
        <ul className="flex flex-col gap-2.5">
          {donations.map((donation) => (
            <li key={donation.id} className={`flex items-center justify-between gap-3 ${card} p-4`}>
              <div className="min-w-0">
                <p className={`font-semibold ${donation.voided ? 'text-stone-400 line-through' : 'text-stone-900'}`}>
                  {donation.donor_name}
                </p>
                <p className={`text-sm text-stone-500 ${donation.voided ? 'line-through' : ''}`}>
                  {formatINR(donation.amount_paise)}
                </p>
                {donation.voided && (
                  <p className="text-[13px] text-stone-400">
                    {t.voidedPrefix}
                    {donation.void_reason}
                  </p>
                )}
              </div>
              {donation.voided ? null : (
                <div className="flex flex-none items-center gap-2">
                  <button type="button" onClick={() => handleSendSms(donation)} className={`${btnGhost} px-3 py-1.5`}>
                    {sentIds.has(donation.id) ? t.sent : t.sendSmsButton}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendWhatsApp(donation)}
                    className={`${btnGhost} px-3 py-1.5`}
                  >
                    {sentIds.has(donation.id) ? t.sent : t.sendWhatsAppButton}
                  </button>
                  <VoidButton label={t.voidButton} prompt={t.voidPrompt} onVoid={(reason) => handleVoid(donation, reason)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  )
}
