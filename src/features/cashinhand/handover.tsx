import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { createHandover, getAdmins, getHandovers, type Admin, type Handover } from '../../lib/db/handovers'
import { voidRow } from '../../lib/db/void'
import { validateHandoverInput, type HandoverValidationErrors } from '../../lib/validation/handover'
import { toPaise } from '../../lib/money'
import { strings } from '../../lib/strings'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { AppShell } from '../../components/AppShell'
import { Money } from '../../components/console'
import { VolunteerTabBar } from '../collection/VolunteerTabBar'
import {
  consoleField,
  ctaDanger,
  ctaMuted,
  ctaOrange,
  errorText,
  eyebrow,
  panel,
  panelTitle,
  pill,
} from '../../components/ui'
import { isAdminRole } from '../../lib/roles'

const t = strings.handovers

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

// Content-only body, reused behind /admin/handovers (inside AdminLayout's console
// frame, reached from the Menu sheet) and /volunteer/handover (inside the
// AppShell wrapper below) — RLS on `handovers` already scopes
// createHandover/getHandovers per-role server-side.
//
// This is the screen that WRITES a handover from the person handing the cash
// over; the Cash tab's log is the same rows read back, and its "Mark settled"
// sheet is the treasurer recording one on a volunteer's behalf.
export function HandoverContent() {
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
  const [voidTarget, setVoidTarget] = useState<Handover | null>(null)
  const [busy, setBusy] = useState(false)

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

  async function handleSubmit() {
    setError(null)

    const result = validateHandoverInput(
      { amountRupees, receivedBy, note },
      admins.map((a) => a.id),
    )
    setErrors(result.errors)
    // volunteerId is never form-editable — it always comes from the session's
    // acting user, resolved once here at submit time.
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

  async function handleVoid(reason: string) {
    const id = voidTarget?.id
    if (!id) return
    setBusy(true)
    try {
      await voidRow('handovers', id, reason || strings.void.defaultReason)
      setHandovers(await getHandovers())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setVoidTarget(null)
    }
  }

  const canSave = Number(amountRupees) > 0 && receivedBy !== ''

  return (
    <>
      <div className={panel}>
        <label htmlFor="handover-amount" className={`${eyebrow} mb-2 block`}>
          {t.amountLabel}
        </label>
        <div className="flex h-[58px] items-center rounded-[14px] border-[1.5px] border-stone-200 bg-white px-3.5 focus-within:border-orange-500">
          <span aria-hidden="true" className="font-display text-2xl font-extrabold text-stone-900">
            ₹
          </span>
          <input
            id="handover-amount"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={amountRupees}
            placeholder="0"
            onChange={(e) => setAmountRupees(e.target.value)}
            className="font-display ml-[7px] min-w-0 flex-1 bg-transparent text-2xl font-extrabold tabular-nums text-stone-900 outline-none placeholder:text-stone-300"
          />
        </div>
        {errors.amountRupees && (
          <p role="alert" className={`mt-1.5 ${errorText}`}>
            {errors.amountRupees}
          </p>
        )}

        <p className={`${eyebrow} mt-4 mb-2`}>{t.receivedByLabel}</p>
        <div role="group" aria-label={t.receivedByLabel} className="flex flex-wrap gap-[7px]">
          {admins.map((admin) => (
            <button
              key={admin.id}
              type="button"
              aria-pressed={receivedBy === admin.id}
              onClick={() => setReceivedBy(admin.id)}
              className={pill(receivedBy === admin.id)}
            >
              {admin.name}
            </button>
          ))}
        </div>
        {errors.receivedBy && (
          <p role="alert" className={`mt-1.5 ${errorText}`}>
            {errors.receivedBy}
          </p>
        )}

        <label htmlFor="handover-note" className={`${eyebrow} mt-4 mb-2 block`}>
          {t.noteLabel}
        </label>
        <input
          id="handover-note"
          value={note}
          placeholder={strings.cashInHand.notePlaceholder}
          onChange={(e) => setNote(e.target.value)}
          className={consoleField}
        />

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || !canSave}
          className={`mt-[18px] ${canSave && !submitting ? ctaOrange : ctaMuted}`}
        >
          {submitting ? t.submitting : t.submitButton}
        </button>
        <p className="mt-2 text-center text-[11px] leading-relaxed font-medium text-stone-400 text-pretty">
          {strings.app.onlineOnlyHint}
        </p>
        {error && (
          <p role="alert" className={`mt-2 ${errorText}`}>
            {error}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : handovers.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
          {t.empty}
        </div>
      ) : (
        <div className={panel}>
          <h2 className={panelTitle}>{strings.cashInHand.handoverLogTitle}</h2>
          <div className="flex flex-col">
            {handovers.map((handover) => {
              const dead = handover.voided
              return (
                <div key={handover.id} className="border-t border-stone-100 py-3">
                  <div className="flex items-baseline gap-2.5">
                    <span
                      className={`min-w-0 flex-1 truncate text-sm font-bold ${dead ? 'text-stone-400 line-through' : 'text-stone-900'}`}
                    >
                      {t.volunteerPrefix}
                      {handover.volunteer?.name ?? t.unknownUser}
                    </span>
                    <Money
                      paise={handover.amount_paise}
                      className={`flex-none text-[15px] font-bold tabular-nums ${dead ? 'text-faint line-through' : ''}`}
                      decClassName={dead ? '' : 'text-stone-400'}
                    />
                  </div>
                  <p className={`mt-0.5 text-[11.5px] font-medium ${dead ? 'text-faint' : 'text-stone-400'}`}>
                    {t.receivedByPrefix}
                    {handover.received_by_user?.name ?? t.unknownUser} · {shortDate(handover.created_at)}
                    {handover.note ? ` · ${handover.note}` : ''}
                  </p>
                  {dead ? (
                    <p className="mt-1 text-[11.5px] font-medium text-faint">
                      {t.voidedPrefix}
                      {handover.void_reason}
                    </p>
                  ) : (
                    <button type="button" onClick={() => setVoidTarget(handover)} className={`mt-2 ${ctaDanger}`}>
                      {t.voidButton}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={voidTarget !== null}
        title={strings.cashInHand.voidHandover}
        body={strings.cashInHand.voidHandoverFootnote}
        confirmLabel={t.voidButton}
        cancelLabel={strings.void.cancel}
        reason={{ label: t.voidPrompt, placeholder: strings.void.reasonPlaceholder }}
        onConfirm={(reason) => void handleVoid(reason)}
        onCancel={() => setVoidTarget(null)}
        busy={busy}
      />
    </>
  )
}

// Volunteer wrapper (/volunteer/handover) — AppShell + bottom tab bar. The admin
// route renders HandoverContent bare inside AdminLayout instead.
export function HandoverScreen() {
  const { appUser } = useAuth()
  const isAdmin = isAdminRole(appUser?.role ?? '')
  const isVolunteer = appUser?.role === 'volunteer'
  const home = isAdmin
    ? { to: '/admin', label: strings.admin.dashboardTitle }
    : { to: '/collect', label: strings.collection.title }

  return (
    <AppShell title={t.title} back={home}>
      <div className="flex flex-col gap-3">
        <HandoverContent />
      </div>
      {isVolunteer && (
        <>
          <div aria-hidden="true" className="h-16" />
          <VolunteerTabBar />
        </>
      )}
    </AppShell>
  )
}
