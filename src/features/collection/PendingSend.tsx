import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { getPendingSendDonations, type Donation } from '../../lib/db/donations'
import { voidRow } from '../../lib/db/void'
import { db, type OutboxDonation } from '../../lib/queue/db'
import { MAX_SYNC_ATTEMPTS, discardOutboxItem } from '../../lib/queue/sync'
import { strings } from '../../lib/strings'
import { sendReceiptSms, sendReceiptWhatsApp } from './send'
import { LanguagePicker } from './LanguagePicker'
import { useReceiptLang } from './useReceiptLang'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { AppShell } from '../../components/AppShell'
import { Money } from '../../components/console'
import { VolunteerTabBar } from './VolunteerTabBar'
import { btnRow, btnRowGreen, ctaDanger, eyebrow, panel } from '../../components/ui'
import { isAdminRole } from '../../lib/roles'

const t = strings.pendingSend

// The "Pending send" tray. Routed at /collect/pending behind RequireRole
// role=['owner', 'admin', 'volunteer'] (src/app/router.tsx) — the caller sees
// only their own donations that haven't had a receipt sent yet (sms_sent_at IS
// NULL and a phone present, RLS-scoped), most recent first. "Send" reuses
// send.ts's sendReceiptSms/WhatsApp — the exact same flow CollectionForm's
// confirmation uses, so a retry here can't drift out of sync with it. Above that
// list sits a second one: this user's still-queued (not-yet-synced) Dexie outbox
// items, with no Send button — there's no public_token to send until the row
// syncs.
//
// Plan 2026-08-18 §2: a donation logged deliberately without a phone never
// appears here at all (the query excludes it), because it can never be sent and
// would otherwise read as a standing chore.
export function PendingSend() {
  const { appUser } = useAuth()
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [queuedItems, setQueuedItems] = useState<OutboxDonation[]>([])
  const [voidTarget, setVoidTarget] = useState<Donation | null>(null)
  const [busy, setBusy] = useState(false)
  // Its own picker, preset the same way: an offline donation arrives here with no
  // collection-time language (threading it through the Dexie outbox is the
  // rejected stored-per-donation design), so it defaults to the mandal's
  // language unless re-picked here.
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
    // idempotency-recovery) — the custom-event mechanism the brief uses in place
    // of a dexie-react-hooks live query, so this tray drops a synced item off
    // its "waiting for signal" list without a page reload.
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

  async function handleVoid(reason: string) {
    const id = voidTarget?.id
    if (!id || !appUser) return
    setBusy(true)
    try {
      await voidRow('donations', id, reason || strings.void.defaultReason)
      setDonations(await getPendingSendDonations(appUser.id))
    } finally {
      setBusy(false)
      setVoidTarget(null)
    }
  }

  const isVolunteer = appUser?.role === 'volunteer'
  const home = isAdminRole(appUser?.role ?? '')
    ? { to: '/admin', label: strings.admin.dashboardTitle }
    : { to: '/collect', label: strings.collection.title }

  return (
    <AppShell title={t.title} back={home}>
      <div className="flex flex-col gap-3">
        <LanguagePicker lang={lang} onChange={setLang} label={strings.collection.languageLabel} />

        {/* Rendered independently of `loading` (which only tracks the
            server-fetched list below) — this is a local, near-instant Dexie
            read, so a volunteer with no signal still sees their own queued
            entries immediately instead of waiting behind a server fetch that may
            never resolve while offline. */}
        {queuedItems.length > 0 && (
          <>
            <p className={eyebrow}>
              {t.sectionTitle} — {queuedItems.length}
              {t.waitingCountSuffix}
            </p>
            {queuedItems.map((item) => {
              const failed = (item.attempts ?? 0) >= MAX_SYNC_ATTEMPTS
              return (
                <div
                  key={item.localId}
                  className={`flex items-center gap-2.5 rounded-[16px] border bg-white p-[13px] ${
                    failed ? 'border-red-200' : 'border-dashed border-stone-300'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-stone-900">{item.donorName}</p>
                    <Money paise={item.amountPaise} className="text-[12.5px] font-medium text-stone-500" />
                    {failed && item.failedReason && (
                      <p className="mt-0.5 text-[11.5px] font-medium text-red-600">
                        {t.failedPrefix}
                        {item.failedReason}
                      </p>
                    )}
                  </div>
                  {failed ? (
                    <div className="flex flex-none items-center gap-2">
                      <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700">
                        {t.needsAttention}
                      </span>
                      <button type="button" onClick={() => discardOutboxItem(item.localId)} className={btnRow}>
                        {t.remove}
                      </button>
                    </div>
                  ) : (
                    <span className="flex-none rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                      {t.waitingForSignal}
                    </span>
                  )}
                </div>
              )
            })}
          </>
        )}

        {loading ? (
          <p className="text-stone-400">{strings.auth.loading}</p>
        ) : donations.length === 0 ? (
          queuedItems.length === 0 && (
            <div className="rounded-[16px] border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
              {t.empty}
            </div>
          )
        ) : (
          donations.map((donation) => (
            <div key={donation.id} className={panel}>
              <div className="flex items-baseline gap-2.5">
                <span
                  className={`min-w-0 flex-1 truncate text-sm font-bold ${donation.voided ? 'text-stone-400 line-through' : 'text-stone-900'}`}
                >
                  {donation.donor_name}
                </span>
                <Money
                  paise={donation.amount_paise}
                  className={`flex-none text-[15px] font-bold tabular-nums ${donation.voided ? 'text-faint line-through' : ''}`}
                  decClassName={donation.voided ? '' : 'text-stone-400'}
                />
              </div>
              {donation.voided ? (
                <p className="mt-1 text-[11.5px] font-medium text-faint">
                  {t.voidedPrefix}
                  {donation.void_reason}
                </p>
              ) : (
                <>
                  <p className="mt-0.5 text-[11.5px] font-medium text-stone-400 tabular-nums">
                    {strings.collections.receiptPrefix}
                    {donation.receipt_no} · {donation.donor_phone}
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleSendSms(donation)}
                      className={`${btnRow} h-[42px] flex-1`}
                    >
                      {sentIds.has(donation.id) ? t.sent : t.sendSmsButton}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendWhatsApp(donation)}
                      className={`${btnRowGreen} h-[42px] flex-1`}
                    >
                      {sentIds.has(donation.id) ? t.sent : t.sendWhatsAppButton}
                    </button>
                  </div>
                  <button type="button" onClick={() => setVoidTarget(donation)} className={`mt-2 ${ctaDanger}`}>
                    {t.voidButton}
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={voidTarget !== null}
        title={strings.collections.deleteTitle}
        body={strings.collections.deleteBody}
        confirmLabel={strings.collections.deleteConfirm}
        cancelLabel={strings.void.cancel}
        reason={{ label: t.voidPrompt, placeholder: strings.void.reasonPlaceholder }}
        onConfirm={(reason) => void handleVoid(reason)}
        onCancel={() => setVoidTarget(null)}
        busy={busy}
      />

      {isVolunteer && (
        <>
          <div aria-hidden="true" className="h-16" />
          <VolunteerTabBar />
        </>
      )}
    </AppShell>
  )
}
