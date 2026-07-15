import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { createHandover, getAdmins, getHandovers, type Admin, type Handover } from '../../lib/db/handovers'
import { voidRow } from '../../lib/db/void'
import { validateHandoverInput, type HandoverValidationErrors } from '../../lib/validation/handover'
import { toPaise, formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { VoidButton } from '../../components/VoidButton'

const t = strings.handovers

// One screen, reused behind both /volunteer/handover (RequireRole
// role="volunteer") and /admin/handovers (RequireRole role="admin") — RLS on
// `handovers` already scopes createHandover/getHandovers per-role
// server-side (see src/lib/db/handovers.ts), same pattern as
// features/expenses/ExpensesScreen.tsx.
export function HandoverScreen() {
  const { appUser } = useAuth()
  const [admins, setAdmins] = useState<Admin[]>([])
  const [handovers, setHandovers] = useState<Handover[]>([])
  const [loading, setLoading] = useState(true)
  const [amountRupees, setAmountRupees] = useState('')
  const [receivedBy, setReceivedBy] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<HandoverValidationErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([getAdmins(), getHandovers()])
      .then(([adminRows, handoverRows]) => {
        if (!active) return
        setAdmins(adminRows)
        setHandovers(handoverRows)
      })
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const result = validateHandoverInput(
      { amountRupees, receivedBy, note },
      admins.map((a) => a.id),
    )
    setErrors(result.errors)
    // volunteerId is never form-editable — it always comes from the
    // session's acting user, resolved once here at submit time.
    if (!result.valid || !appUser) return

    setSubmitting(true)
    try {
      await createHandover({
        amountPaise: toPaise(Number(amountRupees)),
        receivedBy,
        note: note.trim(),
        volunteerId: appUser.id,
      })
      setHandovers(await getHandovers())
      setAmountRupees('')
      setReceivedBy('')
      setNote('')
      setErrors({})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVoid(handover: Handover, reason: string) {
    if (!appUser) return
    try {
      await voidRow('handovers', handover.id, reason, appUser.id)
      setHandovers(await getHandovers())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold text-stone-900">{t.title}</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded border border-stone-300 p-4">
        <label htmlFor="handover-amount" className="text-sm text-stone-600">
          {t.amountLabel}
        </label>
        <input
          id="handover-amount"
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

        <label htmlFor="handover-received-by" className="text-sm text-stone-600">
          {t.receivedByLabel}
        </label>
        <select
          id="handover-received-by"
          value={receivedBy}
          onChange={(event) => setReceivedBy(event.target.value)}
          className="rounded border border-stone-300 px-3 py-3 text-lg"
        >
          <option value="">{t.receivedByPlaceholder}</option>
          {admins.map((admin) => (
            <option key={admin.id} value={admin.id}>
              {admin.name}
            </option>
          ))}
        </select>
        {errors.receivedBy && (
          <p role="alert" className="text-sm text-red-700">
            {errors.receivedBy}
          </p>
        )}

        <label htmlFor="handover-note" className="text-sm text-stone-600">
          {t.noteLabel}
        </label>
        <input
          id="handover-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="rounded border border-stone-300 px-3 py-3 text-lg"
        />

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-orange-700 px-3 py-4 text-lg text-white disabled:opacity-50"
        >
          {submitting ? t.submitting : t.submitButton}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </form>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : handovers.length === 0 ? (
        <p className="text-stone-400">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {handovers.map((handover) => (
            <li key={handover.id} className="rounded border border-stone-200 p-3">
              <div className={`flex items-center justify-between ${handover.voided ? 'text-stone-400 line-through' : ''}`}>
                <span className="font-medium text-stone-900">
                  {t.volunteerPrefix}
                  {handover.volunteer?.name ?? t.unknownUser}
                </span>
                <span>{formatINR(handover.amount_paise)}</span>
              </div>
              <p className={`text-sm text-stone-600 ${handover.voided ? 'line-through' : ''}`}>
                {t.receivedByPrefix}
                {handover.received_by_user?.name ?? t.unknownUser}
              </p>
              {handover.note && (
                <p className={`text-sm text-stone-600 ${handover.voided ? 'line-through' : ''}`}>{handover.note}</p>
              )}
              {handover.voided ? (
                <p className="text-sm text-red-700">
                  {t.voidedPrefix}
                  {handover.void_reason}
                </p>
              ) : (
                <VoidButton label={t.voidButton} prompt={t.voidPrompt} onVoid={(reason) => handleVoid(handover, reason)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
