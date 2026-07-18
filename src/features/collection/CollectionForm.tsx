import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { type Donation } from '../../lib/db/donations'
import { validateDonationInput, type DonationMode, type DonationValidationErrors } from '../../lib/validation/donation'
import { toPaise } from '../../lib/money'
import { strings } from '../../lib/strings'
import { sendReceiptSms, sendReceiptWhatsApp } from './send'
import { LanguagePicker } from './LanguagePicker'
import { useReceiptLang } from './useReceiptLang'
import { enqueueDonation, syncOutboxItem } from '../../lib/queue/sync'
import { AppShell } from '../../components/AppShell'
import { card, fieldLg, label as labelCls, btnPrimaryLg, btnGhost, errorText } from '../../components/ui'

const t = strings.collection

const MODE_OPTIONS: { value: DonationMode; label: string }[] = [
  { value: 'cash', label: t.modeCash },
  { value: 'upi', label: t.modeUpi },
  { value: 'bank', label: t.modeBank },
]

// The volunteer home's own nav to the other volunteer screens. Route is
// structure; the label is copy from strings.collection.
const NAV: { to: string; label: string }[] = [
  { to: '/collect/pending', label: t.pendingSendLink },
  { to: '/collect/history', label: t.collectionsLink },
  { to: '/volunteer/expenses', label: t.expensesLink },
  { to: '/volunteer/handover', label: t.handoversLink },
  { to: '/volunteer/cash-in-hand', label: t.cashInHandLink },
]

// Routed behind RequireRole role="volunteer" (see src/app/router.tsx), so
// appUser is always the volunteer's own `users` row here. This is the
// product's primary screen (SPEC.md): name/phone/amount/mode in, a donation
// row out. Task 10 wraps the write in the offline queue (src/lib/queue) —
// every submit lands in Dexie first, then an immediate sync attempt either
// completes right away (online path, unchanged UX from Tasks 7-9) or leaves
// the entry queued for later (offline path).
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
  const [lang, setLang] = useReceiptLang()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLastDonation(null)
    setSavedOffline(false)

    const result = validateDonationInput({ donorName, donorPhone, amountRupees, mode })
    setErrors(result.errors)
    // collectedBy is never form-editable — it always comes from the
    // session's acting user, resolved once here at submit time.
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
      // Immediate sync attempt, right after enqueueing — on a working
      // connection this completes in about the same time the old direct
      // insert did, so the online-path UX is unchanged from Tasks 7-9.
      const synced = await syncOutboxItem(localId)
      if (synced) {
        setLastDonation(synced)
        // Attempt to open the volunteer's native SMS composer immediately.
        // Per the brief: some browsers block non-http navigation that isn't
        // a direct synchronous consequence of a user gesture, and this runs
        // after an `await`, so it may silently no-op — the always-rendered
        // "Send Receipt" button below is the required fallback, not an
        // extra affordance.
        sendReceiptSms(synced, lang)
      } else {
        // Offline (or a transient failure) — the entry is safely queued in
        // Dexie and will sync once connectivity returns (App.tsx's
        // syncAllPending, run on mount and on the `online` event). No
        // receipt number and no SMS attempt: there's no public_token until
        // the row has actually synced.
        setSavedOffline(true)
      }
      // Reset for the next entry in BOTH cases — a volunteer logs many
      // donations in a row, and per SPEC.md the entry is never lost (it
      // queues locally), so there's no reason to make them wait around.
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

  return (
    <AppShell title={t.title}>
      <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex-none rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-stone-600 transition-colors hover:border-orange-300 hover:text-orange-700"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <form onSubmit={handleSubmit} className={`flex flex-col gap-4 ${card} p-5`}>
        <div className="flex flex-col gap-2">
          <label htmlFor="donor-name" className={labelCls}>
            {t.donorNameLabel}
          </label>
          <input
            id="donor-name"
            value={donorName}
            onChange={(event) => setDonorName(event.target.value)}
            className={fieldLg}
          />
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
            onChange={(event) => setDonorPhone(event.target.value)}
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
            onChange={(event) => setAmountRupees(event.target.value)}
            className={fieldLg}
          />
          {errors.amountRupees && (
            <p role="alert" className={errorText}>
              {errors.amountRupees}
            </p>
          )}
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
                className={`rounded-xl border px-3 py-5 text-lg font-semibold transition-colors ${
                  mode === option.value
                    ? 'border-orange-600 bg-orange-600 text-white shadow-md shadow-orange-600/25'
                    : 'border-stone-300 bg-white text-stone-700 hover:border-stone-400'
                }`}
              >
                {option.label}
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

        {lastDonation && (
          <div className="flex flex-col gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-semibold text-green-800">
              {t.successPrefix}
              {lastDonation.receipt_no} — {t.nextDonation}
            </p>
            {/* Always rendered alongside the auto-redirect attempt above,
                not only when it fails — some browsers block the
                non-http navigation because it follows an `await`, and
                this is the volunteer's explicit-tap fallback for that
                case (Task 8 brief's ≤3-taps acceptance criterion). Two
                channels, volunteer picks: SMS auto-fires above already,
                WhatsApp is opt-in only (opening a new tab isn't something
                to do without a tap). */}
            <div className="flex gap-2.5">
              <button type="button" onClick={() => sendReceiptSms(lastDonation, lang)} className={`flex-1 ${btnGhost}`}>
                {t.sendReceiptSmsButton}
              </button>
              <button
                type="button"
                onClick={() => sendReceiptWhatsApp(lastDonation, lang)}
                className={`flex-1 ${btnGhost}`}
              >
                {t.sendReceiptWhatsAppButton}
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
    </AppShell>
  )
}
