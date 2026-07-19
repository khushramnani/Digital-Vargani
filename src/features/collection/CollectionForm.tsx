import { useState, useEffect, useRef, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { getDonations, type Donation, type DonationCategory } from '../../lib/db/donations'
import { validateDonationInput, type DonationMode, type DonationValidationErrors } from '../../lib/validation/donation'
import { toPaise, formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { sendReceiptSms, sendReceiptWhatsApp, buildReceiptMessage, receiptUrl } from './send'
import { LanguagePicker } from './LanguagePicker'
import { useReceiptLang } from './useReceiptLang'
import { enqueueDonation, syncOutboxItem } from '../../lib/queue/sync'
import { AppShell } from '../../components/AppShell'
import { PhoneInput } from '../../components/PhoneInput'
import { Sheet } from '../../components/Sheet'
import { VolunteerTabBar } from './VolunteerTabBar'
import { card, fieldLg, label as labelCls, btnPrimaryLg, errorText } from '../../components/ui'

const t = strings.collection

const MODE_OPTIONS: { value: DonationMode; label: string; icon: string }[] = [
  { value: 'cash', label: t.modeCash, icon: '💵' },
  { value: 'upi', label: t.modeUpi, icon: '📱' },
  { value: 'bank', label: t.modeBank, icon: '🏦' },
]

// v4 (§2): source category. Remembered per session in localStorage — a
// volunteer often does a whole lane of shops, so the last pick sticks.
const CATEGORY_KEY = 'vm:lastCategory'
const CATEGORY_OPTIONS: { value: DonationCategory; label: string; icon: string }[] = [
  { value: 'society', label: t.categorySociety, icon: '🏠' },
  { value: 'shop', label: t.categoryShop, icon: '🏪' },
  { value: 'other', label: t.categoryOther, icon: '🪔' },
]
function readCategory(): DonationCategory {
  try {
    const v = localStorage.getItem(CATEGORY_KEY)
    return v === 'shop' || v === 'other' ? v : 'society'
  } catch {
    return 'society'
  }
}

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
  const [category, setCategory] = useState<DonationCategory>(readCategory)
  const [errors, setErrors] = useState<DonationValidationErrors>({})
  // Focus returns here after the send sheet dismisses, so the next entry starts
  // immediately (§6 — the "+ New collection" loop, without scrolling).
  const donorNameRef = useRef<HTMLInputElement>(null)
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
        category,
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

  function selectCategory(c: DonationCategory) {
    setCategory(c)
    try {
      localStorage.setItem(CATEGORY_KEY, c)
    } catch {
      /* private mode / storage disabled — the pick still applies this session */
    }
  }

  // §6: a send-tap or Skip dismisses the sheet, clears the form, and drops
  // focus back on the donor-name field for the next entry. The rAF lets the
  // Sheet finish unmounting (its cleanup restores focus to the opener first)
  // before we claim focus, so donor-name wins.
  function handleDismiss() {
    setLastDonation(null)
    setSavedOffline(false)
    setDonorName('')
    setDonorPhone('')
    setAmountRupees('')
    setMode('')
    setErrors({})
    requestAnimationFrame(() => donorNameRef.current?.focus())
  }

  // F1: tapping a channel remembers it, fires that channel's send flow (which
  // marks the donation sent — tap-only, audit v3), then dismisses the sheet.
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
    handleDismiss()
  }

  // One helper, two channels: the primary (last-used) is the big orange
  // btnPrimaryLg; the other is a thumb-height ghost (green accent for
  // WhatsApp) — both easy one-handed taps in the sheet.
  const sendButton = (ch: SendChannel, primary: boolean) => {
    const secondary =
      ch === 'whatsapp'
        ? 'rounded-xl border border-green-500 bg-white px-4 py-4 text-base font-bold text-green-700 transition-colors hover:bg-green-50'
        : 'rounded-xl border border-stone-300 bg-white px-4 py-4 text-base font-bold text-stone-700 transition-colors hover:bg-stone-50'
    return (
      <button type="button" onClick={() => sendVia(ch)} className={primary ? btnPrimaryLg : secondary}>
        {ch === 'whatsapp' ? t.sendReceiptWhatsAppButton : t.sendReceiptSmsButton}
      </button>
    )
  }

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
          <input
            id="donor-name"
            ref={donorNameRef}
            value={donorName}
            onChange={(e) => setDonorName(e.target.value)}
            className={fieldLg}
          />
          {errors.donorName && (
            <p role="alert" className={errorText}>
              {errors.donorName}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {/* v4 §3: E.164 with a visible country code — the old bare field let
              buildWhatsAppLink silently assume +91 for any 10-digit number. */}
          <PhoneInput id="donor-phone" value={donorPhone} onChange={setDonorPhone} label={t.donorPhoneLabel} />
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

        {/* v4 §2: where the money came from. Defaults to Society (the dominant
            door-to-door case) and remembers the last pick — a volunteer often
            works a whole lane of shops in one go. Append-only server-side: a
            wrong source is a void + re-enter, like every other money field. */}
        <div className="flex flex-col gap-2">
          <span className={labelCls}>{t.categoryLabel}</span>
          <div role="group" aria-label={t.categoryLabel} className="grid grid-cols-3 gap-2.5">
            {CATEGORY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={category === option.value}
                onClick={() => selectCategory(option.value)}
                className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
                  category === option.value
                    ? 'border-orange-600 bg-orange-50 text-orange-700 shadow-sm'
                    : 'border-stone-300 bg-white text-stone-700 hover:border-stone-400'
                }`}
              >
                <span aria-hidden="true">{option.icon}</span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <LanguagePicker lang={lang} onChange={setLang} label={t.languageLabel} />

        <button type="submit" disabled={submitting} className={btnPrimaryLg}>
          {submitting ? t.submitting : t.submitButton}
        </button>
        <p className="text-center text-[13px] text-stone-500">{t.offlineMicrocopy}</p>

        {error && (
          <p role="alert" className={errorText}>
            {error}
          </p>
        )}
      </form>

      {/* §6: the send step is a bottom sheet over the dimmed form, not a block
          appended below it. On a phone the old card rendered under the fold —
          after submit the volunteer saw nothing move — and it left the stale
          filled form on screen inviting double-submits. Dismissing the sheet
          (send OR skip) clears the form and refocuses donor-name, so logging
          five in a row never needs a scroll or a manual clear. Skip leaves the
          donation in Pending Send: sms_sent_at stays null because v3 marks sent
          only on an explicit tap. */}
      <Sheet open={!!lastDonation || savedOffline} onClose={handleDismiss} labelledBy="send-sheet-title">
        {lastDonation ? (
          <div className="flex flex-col gap-4">
            <p id="send-sheet-title" className="flex items-center gap-2 text-base font-bold text-stone-900">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-green-600 text-sm text-white"
              >
                ✓
              </span>
              <span>
                {formatINR(lastDonation.amount_paise)}
                {t.loggedPrefix} — {t.successPrefix}
                {lastDonation.receipt_no}
              </span>
            </p>

            {lastDonation.donor_phone ? (
              <>
                <div>
                  <p className="text-sm font-bold text-stone-800">{t.sendTrayTitle}</p>
                  <p className="text-[13px] text-stone-500">{t.sendTrayBody}</p>
                </div>
                {/* The exact text that goes out — one source of truth (send.ts). */}
                <div className="rounded-xl bg-stone-100 p-3">
                  <p className="mb-1 text-[11px] font-semibold tracking-wide text-stone-400 uppercase">
                    {t.smsPreviewLabel}
                  </p>
                  <p className="text-[13px] break-words text-stone-600">{buildReceiptMessage(lastDonation, lang)}</p>
                </div>
                {/* Both channels every time; the last-used one is the primary. */}
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
              </>
            ) : (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-800">
                {t.noPhoneHint}
              </p>
            )}

            {/* Quiet row — neither action sends anything. */}
            <div className="flex items-center justify-between gap-3 border-t border-stone-200 pt-3">
              <button
                type="button"
                onClick={() =>
                  window.open(receiptUrl(lastDonation.receipt_no, lastDonation.public_token, lang), '_blank', 'noopener')
                }
                className="text-sm font-semibold text-orange-600 transition-colors hover:text-orange-700"
              >
                {t.previewReceiptButton}
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="text-sm font-semibold text-stone-500 transition-colors hover:text-stone-800"
              >
                {t.skipForNow}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p id="send-sheet-title" className="flex items-center gap-2 text-base font-bold text-stone-900">
              <span aria-hidden="true" className="h-2.5 w-2.5 flex-none rounded-full bg-amber-500" />
              {t.savedOnPhone}
            </p>
            {/* No receipt number and no send yet — there is no public_token until
                the row actually syncs; it waits in Pending Send. */}
            <p className="text-[13px] text-stone-500">{t.savedOffline}</p>
            <button type="button" onClick={handleDismiss} className={btnPrimaryLg}>
              {t.closeSheet}
            </button>
          </div>
        )}
      </Sheet>

      {isVolunteer && (
        <>
          <div aria-hidden="true" className="h-16" />
          <VolunteerTabBar />
        </>
      )}
    </AppShell>
  )
}
