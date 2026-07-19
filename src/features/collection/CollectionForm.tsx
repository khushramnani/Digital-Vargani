import { useState, useEffect, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { getDonations, type Donation } from '../../lib/db/donations'
import { validateDonationInput, type DonationMode, type DonationValidationErrors } from '../../lib/validation/donation'
import { toPaise, formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { sendReceiptSms, sendReceiptWhatsApp, buildReceiptMessage, receiptUrl } from './send'
import { LanguagePicker } from './LanguagePicker'
import { useReceiptLang } from './useReceiptLang'
import { enqueueDonation, syncOutboxItem } from '../../lib/queue/sync'
import { AppShell } from '../../components/AppShell'
import { VolunteerTabBar } from './VolunteerTabBar'
import { card, fieldLg, label as labelCls, btnPrimaryLg, btnGhost, errorText } from '../../components/ui'

const t = strings.collection

const MODE_OPTIONS: { value: DonationMode; label: string; icon: string }[] = [
  { value: 'cash', label: t.modeCash, icon: '💵' },
  { value: 'upi', label: t.modeUpi, icon: '📱' },
  { value: 'bank', label: t.modeBank, icon: '🏦' },
]

// Auspicious quick-amount chips (design): tapping fills the Amount field.
const QUICK_AMOUNTS = [101, 251, 501, 1100]
const WIDE_AMOUNT = 2100

// The volunteer's last-used send channel is remembered so the send card
// emphasises it as the primary button. Default (and every fresh device) is
// SMS — the zero-cost, arrives-from-you channel. Nothing sends on its own:
// the volunteer taps a button (audit v3 §2.1 — no auto-fire).
const CHANNEL_KEY = 'vm:lastSendChannel'
type SendChannel = 'sms' | 'whatsapp'
function readChannel(): SendChannel {
  try {
    return localStorage.getItem(CHANNEL_KEY) === 'whatsapp' ? 'whatsapp' : 'sms'
  } catch {
    return 'sms'
  }
}

// new-issue #1: the quick-nav targets are role-aware. Admins tapping these
// bounced through /login because expenses/handover/cash-in-hand only exist
// under /volunteer for volunteers; the /admin equivalents are their routes.
// pending/history are the shared /collect/* routes for both roles.
function navFor(role: 'admin' | 'volunteer'): { to: string; label: string }[] {
  const isAdmin = role === 'admin'
  return [
    { to: '/collect/pending', label: t.pendingSendLink },
    { to: '/collect/history', label: t.collectionsLink },
    { to: isAdmin ? '/admin/expenses' : '/volunteer/expenses', label: t.expensesLink },
    { to: isAdmin ? '/admin/handovers' : '/volunteer/handover', label: t.handoversLink },
    { to: isAdmin ? '/admin/cash-in-hand' : '/volunteer/cash-in-hand', label: t.cashInHandLink },
  ]
}

// The product's primary screen (SPEC.md): name/phone/amount/mode in, a
// donation row out. Routed at /collect behind RequireRole role=['admin',
// 'volunteer'] (src/app/router.tsx) — both an admin and a volunteer collect
// the same way, so appUser is whichever of the two is signed in. Every submit
// lands in the Dexie outbox first (src/lib/queue), then an immediate sync
// either completes right away (online) or leaves it queued (offline).
export function CollectionForm() {
  const { appUser } = useAuth()
  const [donorName, setDonorName] = useState('')
  const [donorPhone, setDonorPhone] = useState('')
  const [amountRupees, setAmountRupees] = useState('')
  const [mode, setMode] = useState<DonationMode | ''>('')
  const [errors, setErrors] = useState<DonationValidationErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastDonation, setLastDonation] = useState<Donation | null>(null)
  const [savedOffline, setSavedOffline] = useState(false)
  const [channel, setChannel] = useState<SendChannel>(readChannel)
  const [today, setToday] = useState<{ totalPaise: number; count: number }>({ totalPaise: 0, count: 0 })
  const [lang, setLang] = useReceiptLang()

  const isAdmin = appUser?.role === 'admin'
  const isVolunteer = appUser?.role === 'volunteer'

  // Personal daily total for the greeting chip — this volunteer's own,
  // non-voided donations dated today. RLS already scopes getDonations to the
  // caller's rows; the client-side filter by id/date is belt-and-braces.
  useEffect(() => {
    if (appUser?.role !== 'volunteer') return
    const uid = appUser.id
    let active = true
    getDonations()
      .then((all) => {
        if (!active) return
        const todayStr = new Date().toDateString()
        const mine = all.filter(
          (d) => d.collected_by === uid && !d.voided && new Date(d.created_at).toDateString() === todayStr,
        )
        setToday({ totalPaise: mine.reduce((sum, d) => sum + d.amount_paise, 0), count: mine.length })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [appUser])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLastDonation(null)
    setSavedOffline(false)

    const result = validateDonationInput({ donorName, donorPhone, amountRupees, mode })
    setErrors(result.errors)
    // collectedBy is never form-editable — it always comes from the session's
    // acting user, resolved once here at submit time.
    if (!result.valid || !appUser) return

    setSubmitting(true)
    try {
      // Always lands locally first (Dexie write, can't fail due to network)
      // — this is what makes "no data loss with network off" true.
      const { localId } = await enqueueDonation({
        donorName: donorName.trim(),
        donorPhone: donorPhone.trim(),
        amountPaise: toPaise(Number(amountRupees)),
        mode: mode as DonationMode,
        collectedBy: appUser.id,
      })
      // Immediate sync attempt — online this completes in about the time the
      // old direct insert did, so the online-path UX is unchanged.
      const synced = await syncOutboxItem(localId)
      if (synced) {
        // No auto-fire (audit v3 §2.1): show the send card and let the
        // volunteer tap SMS or WhatsApp. The old auto-open raced the OS
        // composer onto the screen before the choice ever painted, and
        // marked the donation "sent" even when the composer was cancelled —
        // dropping it out of the Pending Send tray (the one place the
        // WhatsApp button persistently lives).
        setLastDonation(synced)
      } else {
        // Offline (or a transient failure) — safely queued in Dexie, will sync
        // once connectivity returns. No receipt number and no send attempt:
        // there's no public_token until the row has actually synced.
        setSavedOffline(true)
      }
      // Reset for the next entry in BOTH cases — a volunteer logs many
      // donations in a row and the entry is never lost (it queues locally).
      setDonorName('')
      setDonorPhone('')
      setAmountRupees('')
      setMode('')
      setErrors({})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  // F1: tapping a channel remembers it and fires that channel's send flow.
  function sendVia(ch: SendChannel) {
    if (!lastDonation) return
    try {
      localStorage.setItem(CHANNEL_KEY, ch)
    } catch {
      /* private mode / storage disabled — the send still fires */
    }
    setChannel(ch)
    if (ch === 'whatsapp') sendReceiptWhatsApp(lastDonation, lang)
    else sendReceiptSms(lastDonation, lang)
  }

  // One helper, two channels: the primary (last-used) gets the big orange
  // btnPrimaryLg so the next step is unmistakable; the other is a ghost.
  const sendButton = (ch: SendChannel, primary: boolean) => (
    <button type="button" onClick={() => sendVia(ch)} className={primary ? btnPrimaryLg : btnGhost}>
      {ch === 'whatsapp' ? t.sendReceiptWhatsAppButton : t.sendReceiptSmsButton}
    </button>
  )

  return (
    <AppShell
      title={t.title}
      subtitle={isVolunteer ? (appUser?.name ? `${t.greetingPrefix}${appUser.name}` : t.greetingFallback) : undefined}
      back={isAdmin ? { to: '/admin', label: t.backToDashboard } : undefined}
      actions={
        isVolunteer ? (
          <span className="flex-none rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700 tabular-nums">
            {formatINR(today.totalPaise)} {t.todayLabel} · {today.count}
            {t.donorsSuffix}
          </span>
        ) : undefined
      }
    >
      {/* Admins collect from the same screen but navigate by these quick chips
          (role-aware targets); volunteers use the bottom tab bar instead. */}
      {isAdmin && (
        <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {navFor('admin').map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex-none rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-stone-600 transition-colors hover:border-orange-300 hover:text-orange-700"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}

      <form onSubmit={handleSubmit} className={`flex flex-col gap-4 ${card} p-5`}>
        <div className="flex flex-col gap-2">
          <label htmlFor="donor-name" className={labelCls}>
            {t.donorNameLabel}
          </label>
          <input id="donor-name" value={donorName} onChange={(e) => setDonorName(e.target.value)} className={fieldLg} />
          {errors.donorName && (
            <p role="alert" className={errorText}>
              {errors.donorName}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="donor-phone" className={labelCls}>
            {t.donorPhoneLabel}
          </label>
          <input
            id="donor-phone"
            type="tel"
            value={donorPhone}
            onChange={(e) => setDonorPhone(e.target.value)}
            className={fieldLg}
          />
          {errors.donorPhone && (
            <p role="alert" className={errorText}>
              {errors.donorPhone}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="donor-amount" className={labelCls}>
            {t.amountLabel}
          </label>
          <input
            id="donor-amount"
            type="number"
            step="0.01"
            min="0"
            value={amountRupees}
            onChange={(e) => setAmountRupees(e.target.value)}
            className={fieldLg}
          />
          {errors.amountRupees && (
            <p role="alert" className={errorText}>
              {errors.amountRupees}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setAmountRupees(String(amt))}
                className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-bold text-stone-700 tabular-nums transition-colors hover:border-orange-400 hover:text-orange-700"
              >
                ₹{amt}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmountRupees(String(WIDE_AMOUNT))}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-bold text-stone-700 tabular-nums transition-colors hover:border-orange-400 hover:text-orange-700"
            >
              ₹{WIDE_AMOUNT}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className={labelCls}>{t.modeLabel}</span>
          <div role="group" aria-label={t.modeLabel} className="grid grid-cols-3 gap-2.5">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={mode === option.value}
                onClick={() => setMode(option.value)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-4 text-base font-semibold transition-colors ${
                  mode === option.value
                    ? 'border-orange-600 bg-orange-50 text-orange-700 shadow-sm'
                    : 'border-stone-300 bg-white text-stone-700 hover:border-stone-400'
                }`}
              >
                <span aria-hidden="true" className="text-2xl leading-none">
                  {option.icon}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          {errors.mode && (
            <p role="alert" className={errorText}>
              {errors.mode}
            </p>
          )}
        </div>

        <LanguagePicker lang={lang} onChange={setLang} label={t.languageLabel} />

        <button type="submit" disabled={submitting} className={btnPrimaryLg}>
          {submitting ? t.submitting : t.submitButton}
        </button>
        <p className="text-center text-[13px] text-stone-500">{t.offlineMicrocopy}</p>

        {lastDonation && (
          <div className="flex flex-col gap-3 rounded-2xl border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-semibold text-green-800">
              {t.successPrefix}
              {lastDonation.receipt_no} — {t.nextDonation}
            </p>
            {lastDonation.donor_phone ? (
              <>
                <div>
                  <p className="text-sm font-bold text-stone-800">{t.sendTrayTitle}</p>
                  <p className="text-[13px] text-stone-500">{t.sendTrayBody}</p>
                </div>
                {/* Exact text that goes out — volunteers see precisely what the
                    donor receives (one source of truth: send.ts). */}
                <div className="rounded-xl bg-white/70 p-3">
                  <p className="mb-1 text-[11px] font-semibold tracking-wide text-stone-400 uppercase">
                    {t.smsPreviewLabel}
                  </p>
                  <p className="text-[13px] break-words text-stone-600">{buildReceiptMessage(lastDonation, lang)}</p>
                </div>
                {/* Both channels render every time; the last-used one is the
                    primary. Nothing sends until one is tapped (no auto-fire). */}
                <div className="flex flex-col gap-2.5">
                  {channel === 'whatsapp' ? (
                    <>
                      {sendButton('whatsapp', true)}
                      {sendButton('sms', false)}
                    </>
                  ) : (
                    <>
                      {sendButton('sms', true)}
                      {sendButton('whatsapp', false)}
                    </>
                  )}
                </div>
                <p className="text-center text-[13px] text-stone-500">{t.offlineMicrocopy}</p>
              </>
            ) : (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-800">
                {t.noPhoneHint}
              </p>
            )}
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() =>
                  window.open(receiptUrl(lastDonation.receipt_no, lastDonation.public_token, lang), '_blank', 'noopener')
                }
                className={`flex-1 ${btnGhost}`}
              >
                {t.previewReceiptButton}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLastDonation(null)
                  setSavedOffline(false)
                }}
                className="flex-1 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-stone-700"
              >
                {t.newCollectionButton}
              </button>
            </div>
          </div>
        )}
        {savedOffline && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800">
            {t.savedOffline}
          </p>
        )}
        {error && (
          <p role="alert" className={errorText}>
            {error}
          </p>
        )}
      </form>

      {isVolunteer && (
        <>
          <div aria-hidden="true" className="h-16" />
          <VolunteerTabBar />
        </>
      )}
    </AppShell>
  )
}
