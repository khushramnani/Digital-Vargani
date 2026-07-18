import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { createHandover, getAdmins, getHandovers, type Admin, type Handover } from '../../lib/db/handovers'
import { voidRow } from '../../lib/db/void'
import { validateHandoverInput, type HandoverValidationErrors } from '../../lib/validation/handover'
import { toPaise, formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { VoidButton } from '../../components/VoidButton'
import { AppShell } from '../../components/AppShell'
import { card, fieldLg, label as labelCls, btnPrimaryLg, errorText } from '../../components/ui'

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
      await voidRow('handovers', handover.id, reason)
      setHandovers(await getHandovers())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const isAdmin = appUser?.role === 'admin'
  const home = isAdmin
    ? { to: '/admin', label: strings.admin.dashboardTitle }
    : { to: '/collect', label: strings.collection.title }

  return (
    <AppShell title={t.title} back={home}>
      <form onSubmit={handleSubmit} className={`flex flex-col gap-4 ${card} p-5`}>
        <div className="flex flex-col gap-2">
          <label htmlFor="handover-amount" className={labelCls}>
            {t.amountLabel}
          </label>
          <input
            id="handover-amount"
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
          <label htmlFor="handover-received-by" className={labelCls}>
            {t.receivedByLabel}
          </label>
          <select
            id="handover-received-by"
            value={receivedBy}
            onChange={(event) => setReceivedBy(event.target.value)}
            className={fieldLg}
          >
            <option value="">{t.receivedByPlaceholder}</option>
            {admins.map((admin) => (
              <option key={admin.id} value={admin.id}>
                {admin.name}
              </option>
            ))}
          </select>
          {errors.receivedBy && (
            <p role="alert" className={errorText}>
              {errors.receivedBy}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="handover-note" className={labelCls}>
            {t.noteLabel}
          </label>
          <input
            id="handover-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={fieldLg}
          />
        </div>

        <button type="submit" disabled={submitting} className={btnPrimaryLg}>
          {submitting ? t.submitting : t.submitButton}
        </button>
        <p className="text-center text-xs text-stone-400">{strings.app.onlineOnlyHint}</p>
        {error && (
          <p role="alert" className={errorText}>
            {error}
          </p>
        )}
      </form>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : handovers.length === 0 ? (
        <EmptyState message={t.empty} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {handovers.map((handover) => (
            <li key={handover.id} className={`${card} p-4`}>
              <div className={`flex items-center justify-between gap-3 ${handover.voided ? 'text-stone-400' : ''}`}>
                <span className={`font-semibold ${handover.voided ? 'text-stone-400 line-through' : 'text-stone-900'}`}>
                  {t.volunteerPrefix}
                  {handover.volunteer?.name ?? t.unknownUser}
                </span>
                <span className={`flex-none font-bold tabular-nums ${handover.voided ? 'line-through' : 'text-stone-900'}`}>
                  {formatINR(handover.amount_paise)}
                </span>
              </div>
              <p className={`mt-0.5 text-sm text-stone-600 ${handover.voided ? 'line-through' : ''}`}>
                {t.receivedByPrefix}
                {handover.received_by_user?.name ?? t.unknownUser}
              </p>
              {handover.note && (
                <p className={`text-sm text-stone-500 ${handover.voided ? 'line-through' : ''}`}>{handover.note}</p>
              )}
              {handover.voided ? (
                <p className="mt-1 text-[13px] text-stone-400">
                  {t.voidedPrefix}
                  {handover.void_reason}
                </p>
              ) : (
                <div className="mt-1 flex justify-end">
                  <VoidButton label={t.voidButton} prompt={t.voidPrompt} onVoid={(reason) => handleVoid(handover, reason)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
      {message}
    </div>
  )
}
