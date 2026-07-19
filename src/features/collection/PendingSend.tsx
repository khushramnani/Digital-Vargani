import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { getPendingSendDonations, type Donation } from '../../lib/db/donations'
import { voidRow } from '../../lib/db/void'
import { db, type OutboxDonation } from '../../lib/queue/db'
import { MAX_SYNC_ATTEMPTS, discardOutboxItem } from '../../lib/queue/sync'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { sendReceiptSms, sendReceiptWhatsApp } from './send'
import { LanguagePicker } from './LanguagePicker'
import { useReceiptLang } from './useReceiptLang'
import { VoidButton } from '../../components/VoidButton'
import { AppShell } from '../../components/AppShell'
import { VolunteerTabBar } from './VolunteerTabBar'
import { card, btnGhost } from '../../components/ui'

const t = strings.pendingSend

// The "Pending send" tray. Routed at /collect/pending behind RequireRole
// role=['admin', 'volunteer'] (src/app/router.tsx) — the caller sees only
// their own donations that haven't had a receipt sent yet (sms_sent_at IS
// NULL, RLS-scoped), most recent first. "Send" reuses send.ts's
// sendReceiptSms/WhatsApp — the exact same flow CollectionForm's auto-send
// uses, so a retry here can't drift out of sync with it. Above that list sits
// a second one: this user's still-queued (not-yet-synced) Dexie outbox items,
// with no Send button — there's no public_token to send until the row syncs.
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

  async function handleVoid(donation: Donation, reason: string) {
    if (!appUser) return
    await voidRow('donations', donation.id, reason)
    setDonations(await getPendingSendDonations(appUser.id))
  }

  const isVolunteer = appUser?.role === 'volunteer'
  const home =
    appUser?.role === 'admin'
      ? { to: '/admin', label: strings.admin.dashboardTitle }
      : { to: '/collect', label: strings.collection.title }

  return (
    <AppShell title={t.title} back={home}>
      <LanguagePicker lang={lang} onChange={setLang} label={strings.collection.languageLabel} />

      {/* Rendered independently of `loading` (which only tracks the
          server-fetched list below) — this is a local, near-instant Dexie
          read, so a volunteer with no signal still sees their own queued
          entries immediately instead of waiting behind a server fetch that
          may never resolve while offline. */}
      {queuedItems.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-bold tracking-wide text-stone-400 uppercase">
            {t.sectionTitle} — {queuedItems.length}
            {t.waitingCountSuffix}
          </p>
          <ul className="flex flex-col gap-2.5">
            {queuedItems.map((item) => {
              const failed = (item.attempts ?? 0) >= MAX_SYNC_ATTEMPTS
              return (
                <li
                  key={item.localId}
                  className={`flex items-center justify-between gap-3 rounded-2xl border bg-white p-4 ${
                    failed ? 'border-red-200' : 'border-dashed border-stone-300'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-stone-900">{item.donorName}</p>
                    <p className="text-sm text-stone-500">{formatINR(item.amountPaise)}</p>
                    {failed && item.failedReason && (
                      <p className="mt-0.5 text-[13px] text-red-600">
                        {t.failedPrefix}
                        {item.failedReason}
                      </p>
                    )}
                  </div>
                  {failed ? (
                    <div className="flex flex-none items-center gap-2">
                      <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                        {t.needsAttention}
                      </span>
                      <button
                        type="button"
                        onClick={() => discardOutboxItem(item.localId)}
                        className={`${btnGhost} px-3 py-1.5`}
                      >
                        {t.remove}
                      </button>
                    </div>
                  ) : (
                    <span className="flex-none rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                      {t.waitingForSignal}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
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
                  {/* audit #4: no phone → no sms:/wa.me link to build, so the
                      send buttons are replaced by a plain hint. */}
                  {donation.donor_phone ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleSendSms(donation)}
                        className={`${btnGhost} px-3 py-1.5`}
                      >
                        {sentIds.has(donation.id) ? t.sent : t.sendSmsButton}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSendWhatsApp(donation)}
                        className={`${btnGhost} px-3 py-1.5`}
                      >
                        {sentIds.has(donation.id) ? t.sent : t.sendWhatsAppButton}
                      </button>
                    </>
                  ) : (
                    <span className="max-w-[9rem] text-right text-[12px] text-stone-400">
                      {strings.collection.noPhoneHint}
                    </span>
                  )}
                  <VoidButton label={t.voidButton} prompt={t.voidPrompt} onVoid={(reason) => handleVoid(donation, reason)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {isVolunteer && (
        <>
          <div aria-hidden="true" className="h-16" />
          <VolunteerTabBar />
        </>
      )}
    </AppShell>
  )
}
