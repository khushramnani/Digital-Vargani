import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { createDonation, type Donation } from '../../lib/db/donations'
import { validateDonationInput, type DonationMode, type DonationValidationErrors } from '../../lib/validation/donation'
import { toPaise } from '../../lib/money'
import { strings } from '../../lib/strings'
import { sendReceiptSms } from './send'

const t = strings.collection

const MODE_OPTIONS: { value: DonationMode; label: string }[] = [
  { value: 'cash', label: t.modeCash },
  { value: 'upi', label: t.modeUpi },
  { value: 'bank', label: t.modeBank },
]

// Routed behind RequireRole role="volunteer" (see src/app/router.tsx), so
// appUser is always the volunteer's own `users` row here. This is the
// product's primary screen (SPEC.md): name/phone/amount/mode in, a donation
// row out. No SMS deep link (Task 8), no receipt page (Task 9), no offline
// queue (Task 10) — those build on top of this.
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLastDonation(null)

    const result = validateDonationInput({ donorName, donorPhone, amountRupees, mode })
    setErrors(result.errors)
    // collectedBy is never form-editable — it always comes from the
    // session's acting user, resolved once here at submit time.
    if (!result.valid || !appUser) return

    setSubmitting(true)
    try {
      const donation = await createDonation({
        donorName: donorName.trim(),
        donorPhone: donorPhone.trim(),
        amountPaise: toPaise(Number(amountRupees)),
        mode: mode as DonationMode,
        collectedBy: appUser.id,
      })
      setLastDonation(donation)
      // Attempt to open the volunteer's native SMS composer immediately.
      // Per the brief: some browsers block non-http navigation that isn't
      // a direct synchronous consequence of a user gesture, and this runs
      // after an `await`, so it may silently no-op — the always-rendered
      // "Send Receipt" button below is the required fallback, not an
      // extra affordance.
      sendReceiptSms(donation)
      // Reset for the next entry — a volunteer logs many donations in a
      // row, so this form never navigates away on success.
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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-stone-900">{t.title}</h1>
        <Link to="/volunteer/pending" className="text-sm text-orange-700 underline">
          {t.pendingSendLink}
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded border border-stone-300 p-4">
        <label htmlFor="donor-name" className="text-sm text-stone-600">
          {t.donorNameLabel}
        </label>
        <input
          id="donor-name"
          value={donorName}
          onChange={(event) => setDonorName(event.target.value)}
          className="rounded border border-stone-300 px-3 py-3 text-lg"
        />
        {errors.donorName && (
          <p role="alert" className="text-sm text-red-700">
            {errors.donorName}
          </p>
        )}

        <label htmlFor="donor-phone" className="text-sm text-stone-600">
          {t.donorPhoneLabel}
        </label>
        <input
          id="donor-phone"
          type="tel"
          value={donorPhone}
          onChange={(event) => setDonorPhone(event.target.value)}
          className="rounded border border-stone-300 px-3 py-3 text-lg"
        />
        {errors.donorPhone && (
          <p role="alert" className="text-sm text-red-700">
            {errors.donorPhone}
          </p>
        )}

        <label htmlFor="donor-amount" className="text-sm text-stone-600">
          {t.amountLabel}
        </label>
        <input
          id="donor-amount"
          type="number"
          step="0.01"
          min="0"
          value={amountRupees}
          onChange={(event) => setAmountRupees(event.target.value)}
          className="rounded border border-stone-300 px-3 py-3 text-lg"
        />
        {errors.amountRupees && (
          <p role="alert" className="text-sm text-red-700">
            {errors.amountRupees}
          </p>
        )}

        <span className="text-sm text-stone-600">{t.modeLabel}</span>
        <div role="group" aria-label={t.modeLabel} className="grid grid-cols-3 gap-2">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              onClick={() => setMode(option.value)}
              className={`rounded border px-3 py-6 text-lg font-medium ${
                mode === option.value
                  ? 'border-orange-700 bg-orange-700 text-white'
                  : 'border-stone-300 text-stone-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {errors.mode && (
          <p role="alert" className="text-sm text-red-700">
            {errors.mode}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-orange-700 px-3 py-4 text-lg text-white disabled:opacity-50"
        >
          {submitting ? t.submitting : t.submitButton}
        </button>

        {lastDonation && (
          <>
            <p className="text-sm text-green-700">
              {t.successPrefix}
              {lastDonation.receipt_no} — {t.nextDonation}
            </p>
            {/* Always rendered alongside the auto-redirect attempt above,
                not only when it fails — some browsers block the
                non-http navigation because it follows an `await`, and
                this is the volunteer's explicit-tap fallback for that
                case (Task 8 brief's ≤3-taps acceptance criterion). */}
            <button
              type="button"
              onClick={() => sendReceiptSms(lastDonation)}
              className="rounded border border-orange-700 px-3 py-3 text-orange-700"
            >
              {t.sendReceiptButton}
            </button>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </form>
    </main>
  )
}
