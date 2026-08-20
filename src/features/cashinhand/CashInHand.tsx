import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { fetchLedgerRows, fetchActiveVolunteers } from '../../lib/db/ledger'
import { createHandover, getAdmins, getHandovers, type Admin, type Handover } from '../../lib/db/handovers'
import { voidRow } from '../../lib/db/void'
import { volunteerCashInHand, type Ledger } from '../../lib/reconcile'
import { isAdminRole } from '../../lib/roles'
import { formatINR, toPaise } from '../../lib/money'
import { strings } from '../../lib/strings'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Sheet } from '../../components/Sheet'
import { AppShell } from '../../components/AppShell'
import { LetterAvatar, Money, SheetHeader } from '../../components/console'
import { HowToSheet } from '../admin/HowToSheet'
import { VolunteerTabBar } from '../collection/VolunteerTabBar'
import {
  consoleField,
  ctaDanger,
  ctaInk,
  ctaMuted,
  ctaOrange,
  errorText,
  eyebrow,
  eyebrowOnDark,
  hero,
  infoRoundOnDark,
  moneyHero,
  panel,
  panelTitle,
  pill,
} from '../../components/ui'

const t = strings.cashInHand

const PAGE = 10

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

type VolunteerRow = { id: string; name: string; collected: number; handed: number; owed: number }
type VolunteerView = { owed: number; collected: number; spent: number; handed: number; handovers: Handover[] }

// Content-only body, reused behind /admin/cash-in-hand (inside AdminLayout's
// console frame) and /volunteer/cash-in-hand (inside the AppShell wrapper
// below). The two roles see genuinely different shapes — a volunteer sees their
// own "you owe the treasurer" hero, an admin sees who is holding what plus the
// handover log — so the body branches on appUser.role. fetchLedgerRows() is
// RLS-scoped (a volunteer's select only returns their own rows), so
// volunteerCashInHand is correct even without a real users/bankOpeningPaise —
// it never reads those fields (see lib/reconcile.ts).
export function CashInHandContent() {
  const { appUser } = useAuth()
  const [rows, setRows] = useState<VolunteerRow[]>([])
  const [handovers, setHandovers] = useState<Handover[]>([])
  const [admins, setAdmins] = useState<Admin[]>([])
  const [vol, setVol] = useState<VolunteerView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [sheet, setSheet] = useState<'settle' | 'handover' | 'howto' | null>(null)
  const [settleFor, setSettleFor] = useState<VolunteerRow | null>(null)
  const [selectedHandoverId, setSelectedHandoverId] = useState<string | null>(null)
  const [voidTarget, setVoidTarget] = useState<Handover | null>(null)
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(1)

  const isAdmin = isAdminRole(appUser?.role ?? '')
  const isVolunteer = appUser?.role === 'volunteer'

  useEffect(() => {
    if (!appUser) return
    let active = true

    async function load() {
      const rowsForLedger = await fetchLedgerRows()
      const built: Ledger = { ...rowsForLedger, users: [], bankOpeningPaise: 0 }
      if (!active) return

      const handoverRows = await getHandovers() // RLS-scoped per role
      if (!active) return
      setHandovers(handoverRows)

      if (isAdminRole(appUser!.role)) {
        const [volunteers, adminRows] = await Promise.all([fetchActiveVolunteers(), getAdmins()])
        if (!active) return
        setAdmins(adminRows)
        setRows(
          volunteers.map((v) => ({
            id: v.id,
            name: v.name,
            collected: built.donations
              .filter((d) => d.mode === 'cash' && d.collectedBy === v.id && !d.voided)
              .reduce((sum, d) => sum + d.amountPaise, 0),
            handed: built.handovers
              .filter((h) => h.volunteerId === v.id && !h.voided)
              .reduce((sum, h) => sum + h.amountPaise, 0),
            owed: volunteerCashInHand(v.id, built),
          })),
        )
        return
      }

      const uid = appUser!.id
      const sum = <T,>(items: T[], pred: (x: T) => boolean, amt: (x: T) => number) =>
        items.filter(pred).reduce((s, x) => s + amt(x), 0)
      setVol({
        owed: volunteerCashInHand(uid, built),
        collected: sum(built.donations, (d) => d.mode === 'cash' && d.collectedBy === uid && !d.voided, (d) => d.amountPaise),
        spent: sum(built.expenses, (e) => e.paidFrom === 'cash' && e.paidBy === uid && !e.voided, (e) => e.amountPaise),
        handed: sum(built.handovers, (h) => h.volunteerId === uid && !h.voided, (h) => h.amountPaise),
        handovers: handoverRows.filter((h) => !h.voided),
      })
    }

    load()
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [appUser])

  async function reload() {
    const rowsForLedger = await fetchLedgerRows()
    const built: Ledger = { ...rowsForLedger, users: [], bankOpeningPaise: 0 }
    setHandovers(await getHandovers())
    if (isAdmin) {
      const volunteers = await fetchActiveVolunteers()
      setRows(
        volunteers.map((v) => ({
          id: v.id,
          name: v.name,
          collected: built.donations
            .filter((d) => d.mode === 'cash' && d.collectedBy === v.id && !d.voided)
            .reduce((sum, d) => sum + d.amountPaise, 0),
          handed: built.handovers
            .filter((h) => h.volunteerId === v.id && !h.voided)
            .reduce((sum, h) => sum + h.amountPaise, 0),
          owed: volunteerCashInHand(v.id, built),
        })),
      )
    }
  }

  async function handleSettle(input: { amountRupees: string; receivedBy: string; note: string }) {
    if (!settleFor) return
    setError(null)
    // A treasurer recording on the volunteer's behalf: volunteer_id is the
    // volunteer whose row was tapped, not the session's own id. Only an admin
    // can do this — handovers_volunteer_insert pins a volunteer to their own id,
    // while handovers_admin_insert allows any volunteer in the mandal, and
    // mandal_id is stamped server-side either way.
    await createHandover({
      amountPaise: toPaise(Number(input.amountRupees)),
      receivedBy: input.receivedBy,
      note: input.note.trim(),
      volunteerId: settleFor.id,
    })
    await reload()
    setSheet(null)
    setSettleFor(null)
  }

  async function handleVoid(reason: string) {
    const id = voidTarget?.id
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      await voidRow('handovers', id, reason || strings.void.defaultReason)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setVoidTarget(null)
    }
  }

  const owing = rows.filter((r) => r.owed > 0)
  // Negative cash-in-hand means the mandal owes THEM — a real state (they paid
  // for something out of their own pocket) and emphatically not "settled".
  const outOfPocket = rows.filter((r) => r.owed < 0)
  const settled = rows.filter((r) => r.owed === 0)
  const totalOwed = rows.reduce((sum, r) => sum + r.owed, 0)
  const totalCollected = rows.reduce((sum, r) => sum + r.collected, 0)
  const totalHanded = rows.reduce((sum, r) => sum + r.handed, 0)
  const shown = Math.min(page * PAGE, handovers.length)
  const selectedHandover = handovers.find((h) => h.id === selectedHandoverId) ?? null

  // Only surface the breakdown stats that carry information — a fresh volunteer
  // who has only collected sees just the hero (collected == owed, so a duplicate
  // card would add nothing).
  const statCards: { label: string; paise: number }[] = []
  if (vol && (vol.spent > 0 || vol.handed > 0)) statCards.push({ label: t.cashCollectedLabel, paise: vol.collected })
  if (vol && vol.spent > 0) statCards.push({ label: t.spentOnMandalLabel, paise: vol.spent })
  if (vol && vol.handed > 0) statCards.push({ label: t.handedOverLabel, paise: vol.handed })

  if (loading) return <p className="text-stone-400">{strings.auth.loading}</p>

  return (
    <>
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {isVolunteer && vol ? (
        <>
          {/* The emotional core: a deep-maroon "you owe the treasurer" hero. The
              owed figure is volunteerCashInHand — the exact number the
              handover/void e2e specs assert drops by the handed/voided amount. */}
          <div className="rounded-[20px] bg-maroon p-5 text-white shadow-[0_16px_30px_-20px_rgba(122,46,42,.7)]">
            <p className={eyebrowOnDark}>{t.youOweLabel}</p>
            <p className={`${moneyHero} mt-1 mb-0.5`}>
              <Money paise={vol.owed} decClassName="text-[19px] opacity-60" />
            </p>
            <p className="text-[11.5px] font-medium text-red-100/80">
              {vol.owed > 0 ? t.youOweSubtitle : t.allSettled}
            </p>
          </div>

          {statCards.length > 0 && (
            <div className="flex gap-2.5">
              {statCards.map((c) => (
                <div key={c.label} className={`${panel} flex-1`}>
                  <p className={eyebrow}>{c.label}</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-stone-900">{formatINR(c.paise)}</p>
                </div>
              ))}
            </div>
          )}

          {vol.owed > 0 && (
            <Link to="/volunteer/handover" className={`${ctaInk} flex items-center justify-center`}>
              {t.handToTreasurerCta}
            </Link>
          )}

          {vol.handovers.length > 0 && (
            <div className={panel}>
              <h2 className={panelTitle}>{t.myHandoversTitle}</h2>
              <div className="flex flex-col">
                {vol.handovers.map((h) => (
                  <div key={h.id} className="flex items-center gap-2.5 border-t border-stone-100 py-3 first:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">
                        {t.receivedByPrefix}
                        {h.received_by_user?.name ?? strings.handovers.unknownUser}
                      </p>
                      <p className="text-[11.5px] font-medium text-stone-400">{shortDate(h.created_at)}</p>
                    </div>
                    <Money paise={h.amount_paise} className="flex-none text-sm font-bold tabular-nums" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={hero}>
            <div className="flex items-center gap-2">
              <span className={eyebrowOnDark}>{t.stillWithVolunteersEyebrow}</span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setSheet('howto')}
                aria-label={strings.admin.howToEyebrow}
                className={`${infoRoundOnDark} -mt-1 -mr-1`}
              >
                i
              </button>
            </div>
            <p className={`${moneyHero} mt-1 mb-0.5 text-red-300`}>
              <Money paise={totalOwed} decClassName="text-[19px] opacity-60" />
            </p>
            <p className="text-[11.5px] font-medium text-stone-400">
              {owing.length === 0 ? t.everyoneSettled : t.stillHoldingCash(owing.length, rows.length)}
            </p>
            <div className="mt-3 flex items-start gap-2.5 border-t border-white/12 pt-3">
              <div className="min-w-0 flex-1">
                <p className="text-[9.5px] font-bold tracking-[0.12em] text-stone-500 uppercase">
                  {t.cashCollectedLabel}
                </p>
                <p className="mt-px text-[15px] font-bold tabular-nums">
                  <Money paise={totalCollected} />
                </p>
              </div>
              <div aria-hidden="true" className="w-px self-stretch bg-white/12" />
              <div className="min-w-0 flex-1">
                <p className="text-[9.5px] font-bold tracking-[0.12em] text-stone-500 uppercase">{t.handedInLabel}</p>
                <p className="mt-px text-[15px] font-bold tabular-nums text-green-300">
                  <Money paise={totalHanded} decClassName="opacity-60" />
                </p>
              </div>
            </div>
          </div>

          <div className={panel}>
            <div className="flex items-baseline justify-between gap-2.5">
              <h2 className={panelTitle}>{t.volunteersTitle}</h2>
              <span className="text-[11px] font-semibold text-stone-400">
                {owing.length > 0
                  ? t.owingLabel(owing.length)
                  : outOfPocket.length > 0
                    ? t.outOfPocket(outOfPocket.length)
                    : t.allSettledLabel}
              </span>
            </div>

            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-stone-400">{t.empty}</p>
            ) : (
              <>
                {owing.map((r) => (
                  <div key={r.id}>
                    <div className="mt-3 flex items-center gap-[11px] border-t border-stone-100 pt-3">
                      <LetterAvatar name={r.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{r.name}</p>
                        <p className="text-[11.5px] font-medium tabular-nums text-stone-400">
                          {t.collectedPrefix}
                          {formatINR(r.collected)} · {t.handedPrefix}
                          {formatINR(r.handed)}
                        </p>
                      </div>
                      <div className="flex-none text-right">
                        <Money paise={r.owed} className="text-[14.5px] font-bold tabular-nums" />
                        <p className="text-[10px] font-bold tracking-[0.02em] text-orange-600">{t.stillOwesTag}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSettleFor(r)
                        setSheet('settle')
                      }}
                      className="mt-2 h-[38px] w-full rounded-[11px] bg-stone-900 text-[12.5px] font-bold text-white transition-colors hover:bg-stone-800"
                    >
                      {t.markSettled} · {formatINR(r.owed)}
                    </button>
                  </div>
                ))}

                {outOfPocket.map((r) => (
                  <div key={r.id} className="mt-3 flex items-center gap-[11px] border-t border-stone-100 pt-3">
                    <LetterAvatar name={r.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{r.name}</p>
                      <p className="text-[11.5px] font-medium tabular-nums text-stone-400">
                        {t.collectedPrefix}
                        {formatINR(r.collected)} · {t.handedPrefix}
                        {formatINR(r.handed)}
                      </p>
                    </div>
                    <div className="flex-none text-right">
                      <Money paise={-r.owed} className="text-[14.5px] font-bold tabular-nums text-maroon" />
                      <p className="text-[10px] font-bold tracking-[0.02em] text-maroon">{t.mandalOwesTag}</p>
                    </div>
                  </div>
                ))}
                {/* Said once for the group, not repeated per row. */}
                {outOfPocket.length > 0 && (
                  <p className="mt-2 text-[11px] leading-relaxed font-medium text-stone-400 text-pretty">
                    {t.mandalOwesHint}
                  </p>
                )}

                {settled.map((r) => (
                  <div key={r.id} className="mt-3 flex items-center gap-[11px] border-t border-stone-100 pt-3">
                    <LetterAvatar name={r.name} muted size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-stone-600">{r.name}</p>
                      <p className="text-[11px] font-medium tabular-nums text-stone-400">
                        {t.collectedPrefix}
                        {formatINR(r.collected)} · {t.handedPrefix}
                        {formatINR(r.handed)}
                      </p>
                    </div>
                    <div className="flex flex-none items-center gap-2">
                      <span className="text-[9.5px] font-bold tracking-[0.1em] text-green-600 uppercase">
                        {t.settledTag}
                      </span>
                      <span className="text-[13px] font-semibold tabular-nums text-stone-400">
                        {formatINR(r.owed)}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className={panel}>
            <div className="mb-0.5 flex items-baseline justify-between gap-2.5">
              <h2 className={panelTitle}>{t.handoverLogTitle}</h2>
              <span className="text-[11px] font-semibold text-stone-400">{t.handoverCount(handovers.length)}</span>
            </div>
            {handovers.length === 0 ? (
              <p className="py-4 text-center text-xs font-medium text-stone-400">{t.noHandovers}</p>
            ) : (
              <div className="flex flex-col">
                {handovers.slice(0, shown).map((h) => {
                  const dead = h.voided
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setSelectedHandoverId(h.id)}
                      className="flex items-center gap-2.5 border-t border-stone-100 py-3 text-left transition-colors hover:bg-stone-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13.5px] font-bold ${dead ? 'text-stone-400 line-through' : 'text-stone-900'}`}
                        >
                          {strings.handovers.volunteerPrefix}
                          {h.volunteer?.name ?? strings.handovers.unknownUser}
                        </span>
                        <span className={`mt-0.5 block text-[11.5px] font-medium ${dead ? 'text-faint' : 'text-stone-400'}`}>
                          {dead
                            ? `${strings.handovers.voidedPrefix}${h.void_reason ?? ''}`
                            : `${t.receivedByPrefix}${h.received_by_user?.name ?? strings.handovers.unknownUser}${h.note ? ` · ${h.note}` : ''}`}
                        </span>
                      </span>
                      <Money
                        paise={h.amount_paise}
                        className={`flex-none text-sm font-bold tabular-nums ${dead ? 'text-faint line-through' : ''}`}
                        decClassName={dead ? '' : 'text-stone-400'}
                      />
                    </button>
                  )
                })}
                {shown < handovers.length && (
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    className="mt-3 h-[34px] w-full rounded-[11px] border border-stone-200 bg-white text-xs font-bold text-stone-700 transition-colors hover:border-stone-900"
                  >
                    {strings.app.loadMore}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {settleFor && (
        <SettleSheet
          open={sheet === 'settle'}
          onClose={() => {
            setSheet(null)
            setSettleFor(null)
          }}
          volunteer={settleFor}
          admins={admins}
          onSubmit={handleSettle}
        />
      )}

      <HandoverDetailSheet
        handover={selectedHandover}
        onClose={() => setSelectedHandoverId(null)}
        canVoid={isAdmin || selectedHandover?.volunteer_id === appUser?.id}
        onVoid={() => {
          setVoidTarget(selectedHandover)
          setSelectedHandoverId(null)
        }}
      />

      <HowToSheet tab="cash" open={sheet === 'howto'} onClose={() => setSheet(null)} />

      <ConfirmDialog
        open={voidTarget !== null}
        title={t.voidHandover}
        body={t.voidHandoverFootnote}
        confirmLabel={strings.handovers.voidButton}
        cancelLabel={strings.void.cancel}
        reason={{ label: strings.handovers.voidPrompt, placeholder: strings.void.reasonPlaceholder }}
        onConfirm={(reason) => void handleVoid(reason)}
        onCancel={() => setVoidTarget(null)}
        busy={busy}
      />
    </>
  )
}

// "Mark settled": the treasurer records a handover the volunteer forgot to log.
// The volunteer's balance drops, the handover appears in the log, and the books
// stay balanced — which is exactly why it is a handover row and not an edit.
function SettleSheet({
  open,
  onClose,
  volunteer,
  admins,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  volunteer: VolunteerRow
  admins: Admin[]
  onSubmit: (input: { amountRupees: string; receivedBy: string; note: string }) => Promise<void>
}) {
  if (!open) return null
  return (
    <Sheet open onClose={onClose} labelledBy="settle-sheet-title">
      <SettleSheetBody onClose={onClose} volunteer={volunteer} admins={admins} onSubmit={onSubmit} />
    </Sheet>
  )
}

function SettleSheetBody({
  onClose,
  volunteer,
  admins,
  onSubmit,
}: {
  onClose: () => void
  volunteer: VolunteerRow
  admins: Admin[]
  onSubmit: (input: { amountRupees: string; receivedBy: string; note: string }) => Promise<void>
}) {
  const [amountRupees, setAmountRupees] = useState('')
  const [receivedBy, setReceivedBy] = useState(admins[0]?.id ?? '')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = Number(amountRupees) > 0 && receivedBy !== ''

  async function submit() {
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({ amountRupees, receivedBy, note })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <SheetHeader
        title={t.settleSheetTitle}
        titleId="settle-sheet-title"
        hint={t.settleSheetHint(volunteer.name, formatINR(volunteer.owed))}
        onClose={onClose}
        closeLabel={strings.app.close}
      />

      <label htmlFor="settle-amount" className={`${eyebrow} mt-[18px] mb-2 block`}>
        {t.amountReceivedLabel}
      </label>
      <div className="flex h-[58px] items-center rounded-[14px] border-[1.5px] border-stone-200 bg-white px-3.5 focus-within:border-orange-500">
        <span aria-hidden="true" className="font-display text-2xl font-extrabold text-stone-900">
          ₹
        </span>
        <input
          id="settle-amount"
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
      {/* A partial handover is legitimate (they hand over what they have on
          them), so the full amount is one tap rather than the only option. */}
      <button
        type="button"
        onClick={() => setAmountRupees(String(volunteer.owed / 100))}
        className="mt-2 h-[30px] rounded-full bg-stone-100 px-[11px] text-[11.5px] font-bold text-stone-600 transition-colors hover:bg-stone-200"
      >
        {t.fullAmountPrefix}
        {formatINR(volunteer.owed)}
      </button>

      <p className={`${eyebrow} mt-4 mb-2`}>{strings.handovers.receivedByLabel}</p>
      <div role="group" aria-label={strings.handovers.receivedByLabel} className="flex flex-wrap gap-[7px]">
        {admins.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={receivedBy === a.id}
            onClick={() => setReceivedBy(a.id)}
            className={pill(receivedBy === a.id)}
          >
            {a.name}
          </button>
        ))}
      </div>

      <label htmlFor="settle-note" className={`${eyebrow} mt-4 mb-2 block`}>
        {strings.handovers.noteLabel}
      </label>
      <input
        id="settle-note"
        value={note}
        placeholder={t.notePlaceholder}
        onChange={(e) => setNote(e.target.value)}
        className={consoleField}
      />

      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting || !canSave}
        className={`mt-[18px] ${canSave && !submitting ? ctaOrange : ctaMuted}`}
      >
        {submitting ? strings.handovers.submitting : t.recordHandover}
      </button>
      <p className="mt-2 text-center text-[11px] leading-relaxed font-medium text-stone-400 text-pretty">
        {t.settleFootnote}
      </p>
      {error && (
        <p role="alert" className={`mt-2 ${errorText}`}>
          {error}
        </p>
      )}
    </>
  )
}

function HandoverDetailSheet({
  handover,
  onClose,
  canVoid,
  onVoid,
}: {
  handover: Handover | null
  onClose: () => void
  canVoid: boolean
  onVoid: () => void
}) {
  if (!handover) return null
  return (
    <Sheet open onClose={onClose} labelledBy="handover-detail-title">
      <SheetHeader
        title={`${strings.handovers.volunteerPrefix}${handover.volunteer?.name ?? strings.handovers.unknownUser}`}
        titleId="handover-detail-title"
        hint={`${t.receivedByPrefix}${handover.received_by_user?.name ?? strings.handovers.unknownUser} · ${shortDate(handover.created_at)}`}
        onClose={onClose}
        closeLabel={strings.app.close}
      />

      <p className="font-display mt-3.5 mb-1 text-[34px] font-extrabold tracking-[-0.03em] tabular-nums">
        <Money paise={handover.amount_paise} decClassName="text-[19px] text-stone-400" />
      </p>
      <p className="text-[12.5px] font-medium text-stone-600">{handover.note || t.noNote}</p>

      {handover.voided ? (
        <p className="mt-4 rounded-xl border border-dashed border-stone-200 bg-stone-50 px-[13px] py-3 text-xs font-semibold text-stone-500">
          {t.handoverVoidedNote(handover.void_reason ?? '')}
        </p>
      ) : (
        canVoid && (
          <>
            <button type="button" onClick={onVoid} className={`mt-[18px] ${ctaDanger}`}>
              {t.voidHandover}
            </button>
            <p className="mt-1.5 text-center text-[10.5px] font-medium text-faint">{t.voidHandoverFootnote}</p>
          </>
        )
      )}
    </Sheet>
  )
}

// Volunteer wrapper (/volunteer/cash-in-hand) — AppShell + bottom tab bar. The
// admin route renders CashInHandContent bare inside AdminLayout instead.
export function CashInHandScreen() {
  const { appUser } = useAuth()
  const isAdmin = isAdminRole(appUser?.role ?? '')
  const isVolunteer = appUser?.role === 'volunteer'
  const home = isAdmin
    ? { to: '/admin', label: strings.admin.dashboardTitle }
    : { to: '/collect', label: strings.collection.title }

  return (
    <AppShell title={t.title} back={home}>
      <div className="flex flex-col gap-3">
        <CashInHandContent />
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
