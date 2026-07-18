import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { getDonations, type Donation } from '../../lib/db/donations'
import { voidRow, clearAllDonations } from '../../lib/db/void'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { VoidButton } from '../../components/VoidButton'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { AppShell } from '../../components/AppShell'

const t = strings.collections

// SPEC.md's "my collections" (volunteer) / "all collections" (admin) screen.
// One screen, reused behind both /volunteer/collections and
// /admin/collections — RLS on `donations` scopes getDonations per-role
// server-side. Deleting a donation is a soft void (it drops out of every
// total and the public report while the record survives for the audit
// trail); removed rows are hidden behind a toggle so the list reads as a
// clean, current ledger. Admins additionally get a bulk "clear everything".
export function CollectionsScreen() {
  const { appUser } = useAuth()
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showRemoved, setShowRemoved] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  function load() {
    return getDonations().then(setDonations)
  }

  useEffect(() => {
    let active = true
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
  }, [])

  async function handleVoid(donation: Donation, reason: string) {
    if (!appUser) return
    setNotice(null)
    try {
      await voidRow('donations', donation.id, reason)
      setDonations(await getDonations())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleClearAll(reason: string) {
    setClearing(true)
    setError(null)
    setNotice(null)
    try {
      await clearAllDonations(reason)
      setDonations(await getDonations())
      setNotice(t.cleared)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setClearing(false)
      setClearOpen(false)
    }
  }

  const active = donations.filter((d) => !d.voided)
  const removed = donations.filter((d) => d.voided)
  const isAdmin = appUser?.role === 'admin'
  const visible = showRemoved ? donations : active
  const home = isAdmin
    ? { to: '/admin', label: strings.admin.dashboardTitle }
    : { to: '/volunteer', label: strings.collection.title }

  return (
    <AppShell
      title={t.title}
      back={home}
      actions={
        removed.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowRemoved((s) => !s)}
            className="flex-none rounded-lg px-2.5 py-1.5 text-sm font-semibold text-stone-500 hover:bg-stone-100"
          >
            {showRemoved ? t.removedHide : `${t.removedShow} (${removed.length})`}
          </button>
        ) : undefined
      }
    >
      {notice && (
        <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-800">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : donations.length === 0 ? (
        <EmptyState message={t.empty} />
      ) : visible.length === 0 ? (
        <EmptyState message={t.empty} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visible.map((donation) => (
            <li
              key={donation.id}
              className={`rounded-2xl border p-4 ${
                donation.voided ? 'border-stone-200 bg-stone-50' : 'border-stone-200 bg-white shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className={`truncate font-semibold ${donation.voided ? 'text-stone-400 line-through' : 'text-stone-900'}`}
                  >
                    {donation.donor_name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-stone-500">
                    <span>
                      {t.receiptPrefix}
                      {donation.receipt_no}
                    </span>
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
                      {donation.mode}
                    </span>
                  </p>
                </div>
                <span
                  className={`flex-none text-lg font-bold tabular-nums ${donation.voided ? 'text-stone-400 line-through' : 'text-stone-900'}`}
                >
                  {formatINR(donation.amount_paise)}
                </span>
              </div>

              {donation.voided ? (
                <p className="mt-2 text-[13px] text-stone-400">
                  {t.voidedPrefix}
                  {donation.void_reason}
                </p>
              ) : (
                <div className="mt-1 flex justify-end">
                  <VoidButton
                    label={t.deleteButton}
                    confirmLabel={t.deleteConfirm}
                    title={t.deleteTitle}
                    body={t.deleteBody}
                    prompt={t.deleteReasonLabel}
                    onVoid={(reason) => handleVoid(donation, reason)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && active.length > 0 && (
        <section className="mt-2 rounded-2xl border border-red-200 bg-red-50/50 p-5">
          <h2 className="text-sm font-bold tracking-wide text-red-700 uppercase">{t.dangerZone}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-stone-600">{t.clearAllHint}</p>
          <button
            type="button"
            onClick={() => setClearOpen(true)}
            className="mt-3 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-600 hover:text-white"
          >
            {t.clearAllButton}
          </button>
        </section>
      )}

      <ConfirmDialog
        open={clearOpen}
        title={t.clearAllTitle}
        body={t.clearAllBody}
        confirmLabel={t.clearAllConfirm}
        cancelLabel={strings.void.cancel}
        reason={{ label: t.clearAllReasonLabel, placeholder: t.clearAllReasonPlaceholder }}
        requirePhrase={{ label: t.clearAllPhraseLabel, phrase: t.clearAllPhrase }}
        onConfirm={handleClearAll}
        onCancel={() => setClearOpen(false)}
        busy={clearing}
      />
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
