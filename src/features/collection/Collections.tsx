import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/useAuth'
import { getDonations, type Donation } from '../../lib/db/donations'
import { voidRow, clearAllDonations, purgeDonations } from '../../lib/db/void'
import { fetchMandalUserNames } from '../../lib/db/users'
import { isAdminRole, isOwnerRole } from '../../lib/roles'
import { formatForDisplay, normalizeToE164, waDigits } from '../../lib/phone'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { VoidButton } from '../../components/VoidButton'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { AppShell } from '../../components/AppShell'
import { VolunteerTabBar } from './VolunteerTabBar'

const t = strings.collections

const MODE_ICON: Record<string, string> = { cash: '💵', upi: '📱', bank: '🏦' }

// v4: source category → icon + label for the per-row chip and detail panel.
const CATEGORY: Record<string, { icon: string; label: string }> = {
  society: { icon: '🏠', label: strings.collection.categorySociety },
  shop: { icon: '🏪', label: strings.collection.categoryShop },
  other: { icon: '🪔', label: strings.collection.categoryOther },
}

// Short, human timestamp for a row subline — "Today, 4:20 PM" for today,
// otherwise "2 Jan, 4:20 PM". Display-only; never feeds a total.
function shortTime(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === new Date().toDateString()) return `Today, ${time}`
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`
}

// Full date+time for the expanded row detail (the subline stays terse).
function fullTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

const yearOf = (iso: string): number => new Date(iso).getFullYear()

// SPEC.md's "my collections" (volunteer) / "all collections" (admin) screen.
// Content-only body: rendered inside AdminLayout's <Outlet/> at
// /admin/collections (console frame) and inside the AppShell wrapper below at
// /collect/history (volunteer/collect flow). RLS on `donations` scopes
// getDonations per-role server-side. Each row expands (v4 §1a) to reveal donor
// contact (tap-to-call / WhatsApp), who collected it, and the receipt link.
// Deleting a donation is a soft void (it drops out of every total and the
// public report while the record survives for the audit trail); removed rows
// are hidden behind a toggle. Admins additionally get a Danger Zone: the
// everyday soft "clear all", plus a true permanent purge (v4 §8).
export function CollectionsContent() {
  const { appUser } = useAuth()
  const [donations, setDonations] = useState<Donation[]>([])
  // collected_by (a users.id) → display name; admin-only server-side, so a
  // volunteer session just gets {} and every collector falls back to "Unknown".
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showRemoved, setShowRemoved] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState('all')
  const [yearFilter, setYearFilter] = useState('all')
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [purgeRemovedOpen, setPurgeRemovedOpen] = useState(false)
  const [purgeAllOpen, setPurgeAllOpen] = useState(false)
  const [purging, setPurging] = useState(false)
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
    // Names power the "collected by" line; best-effort (empty for volunteers).
    fetchMandalUserNames()
      .then((n) => {
        if (active) setNames(n)
      })
      .catch(() => {})
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

  // The first true hard-delete path (v4 §8). It erases SERVER history only —
  // the local Dexie outbox is deliberately left alone.
  //
  // An earlier revision cleared the outbox here "so a synced item can't
  // resurrect a purged donation". That was unsafe: the outbox holds ONLY
  // donations that have not reached the server yet (queue/db.ts), it is
  // device-global (not mandal-scoped), and sync deliberately keeps rows it
  // cannot push — ones tagged for a different volunteer's session on a shared
  // phone (sync.ts's authUserId fence) and poison rows awaiting triage. Wiping
  // it destroyed collected money whose only copy was that row, for a volunteer
  // whose queue the purging admin could never even see (PendingSend filters the
  // tray by collectedBy). Unrecoverable, and reachable while fully online.
  // The "resurrection" it guarded against is the rare crash-between-insert-and-
  // local-delete case — and for a genuinely unsynced row, syncing it after a
  // purge is the CORRECT outcome, not a bug. No-data-loss wins.
  async function handlePurge(scope: 'removed' | 'all') {
    setPurging(true)
    setError(null)
    setNotice(null)
    try {
      await purgeDonations(scope)
      setDonations(await getDonations())
      setNotice(scope === 'all' ? t.purgedAllNotice : t.purgedRemovedNotice)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPurging(false)
      setPurgeRemovedOpen(false)
      setPurgeAllOpen(false)
    }
  }

  async function copyReceiptLink(donation: Donation) {
    await navigator.clipboard.writeText(
      `${window.location.origin}/r/${donation.receipt_no}-${donation.public_token}`,
    )
    setCopiedId(donation.id)
    setTimeout(() => setCopiedId((c) => (c === donation.id ? null : c)), 2000)
  }

  const isAdmin = isAdminRole(appUser?.role ?? '')
  const isOwner = isOwnerRole(appUser?.role ?? '')
  const hasActive = donations.some((d) => !d.voided)
  const years = [...new Set(donations.map((d) => yearOf(d.created_at)))].sort((a, b) => b - a)

  const filtered = donations.filter(
    (d) =>
      (sourceFilter === 'all' || d.category === sourceFilter) &&
      (yearFilter === 'all' || String(yearOf(d.created_at)) === yearFilter),
  )
  const removed = filtered.filter((d) => d.voided)
  const active = filtered.filter((d) => !d.voided)
  const visible = showRemoved ? filtered : active

  return (
    <>
      {donations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t.detailCategory}
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-700"
          >
            <option value="all">{t.categoryFilterAll}</option>
            <option value="society">{strings.collection.categorySociety}</option>
            <option value="shop">{strings.collection.categoryShop}</option>
            <option value="other">{strings.collection.categoryOther}</option>
          </select>
          <select
            aria-label={t.yearFilterLabel}
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-700"
          >
            <option value="all">{t.allYears}</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
          {removed.length > 0 && (
            <button
              type="button"
              onClick={() => setShowRemoved((s) => !s)}
              className="ml-auto flex-none rounded-lg px-2.5 py-1.5 text-sm font-semibold text-stone-500 hover:bg-stone-100"
            >
              {showRemoved ? t.removedHide : `${t.removedShow} (${removed.length})`}
            </button>
          )}
        </div>
      )}
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
        /* Filtered to nothing — NOT the same as "no donations yet". Showing the
           empty-ledger copy here reads as data loss, which is alarming sitting
           directly above a Danger Zone that can permanently erase history. */
        <EmptyState message={t.noFilterResults} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visible.map((donation) => {
            const cat = CATEGORY[donation.category] ?? CATEGORY.other
            const isOpen = expandedId === donation.id
            const phone = donation.donor_phone ? normalizeToE164(donation.donor_phone) : ''
            return (
              <li
                key={donation.id}
                className={`rounded-2xl border p-4 ${
                  donation.voided ? 'border-stone-200 bg-stone-50' : 'border-stone-200 bg-white shadow-sm'
                }`}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpandedId((id) => (id === donation.id ? null : donation.id))}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl border text-xl ${
                        donation.voided ? 'border-stone-200 bg-stone-100 opacity-60' : 'border-stone-200 bg-stone-50'
                      }`}
                    >
                      {MODE_ICON[donation.mode] ?? '💰'}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={`truncate font-semibold ${donation.voided ? 'text-stone-400 line-through' : 'text-stone-900'}`}
                      >
                        {donation.donor_name}
                      </p>
                      <p className="mt-0.5 text-[13px] text-stone-500">
                        {t.receiptPrefix}
                        {donation.receipt_no} · <span className="capitalize">{donation.mode}</span> ·{' '}
                        {shortTime(donation.created_at)}
                      </p>
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                        <span aria-hidden="true">{cat.icon}</span>
                        {cat.label}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`flex-none text-lg font-bold tabular-nums ${donation.voided ? 'text-stone-400 line-through' : 'text-stone-900'}`}
                  >
                    {formatINR(donation.amount_paise)}
                  </span>
                </button>

                {donation.voided && (
                  <p className="mt-2 text-[13px] text-stone-400">
                    {t.voidedPrefix}
                    {donation.void_reason}
                  </p>
                )}

                {isOpen && (
                  <div className="mt-3 flex flex-col gap-3 border-t border-stone-100 pt-3 text-sm">
                    {phone && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-stone-500">{t.detailPhone}</span>
                        <a
                          href={`tel:${phone}`}
                          className="font-semibold text-stone-900 underline decoration-dotted underline-offset-2"
                        >
                          {formatForDisplay(phone)}
                        </a>
                        <a
                          href={`tel:${phone}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                        >
                          📞 {t.detailCall}
                        </a>
                        <a
                          href={`https://wa.me/${waDigits(phone)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-100"
                        >
                          💬 {t.detailWhatsApp}
                        </a>
                      </div>
                    )}

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                      <Detail label={t.detailCategory} value={`${cat.icon} ${cat.label}`} />
                      <Detail label={strings.collection.modeLabel} value={<span className="capitalize">{donation.mode}</span>} />
                      <Detail label={t.detailCollectedBy} value={names[donation.collected_by] ?? t.unknownCollector} />
                      {/* TODO(strings): no `collections.detailDate` key staged — inline for now. */}
                      <Detail label="Date" value={fullTime(donation.created_at)} />
                    </dl>

                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`/r/${donation.receipt_no}-${donation.public_token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                      >
                        {t.detailOpenReceipt}
                      </a>
                      <button
                        type="button"
                        onClick={() => copyReceiptLink(donation)}
                        className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                      >
                        {copiedId === donation.id ? t.detailCopied : t.detailCopyLink}
                      </button>
                    </div>
                  </div>
                )}

                {!donation.voided && (
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
            )
          })}
        </ul>
      )}

      {isAdmin && donations.length > 0 && (
        <section className="mt-2 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/50 p-5">
          <div>
            <h2 className="text-sm font-bold tracking-wide text-red-700 uppercase">{t.dangerZone}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-stone-600">{t.keepPastYearsHint}</p>
          </div>

          {hasActive && (
            <div>
              <p className="text-[13px] leading-relaxed text-stone-600">{t.clearAllHint}</p>
              <button
                type="button"
                onClick={() => setClearOpen(true)}
                className="mt-2 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-600 hover:text-white"
              >
                {t.clearAllButton}
              </button>
            </div>
          )}

          {isOwner && (
            <div className="flex flex-col gap-3 border-t border-red-200 pt-3">
              <div>
                <p className="text-[13px] leading-relaxed text-stone-600">{t.purgeRemovedHint}</p>
                <button
                  type="button"
                  onClick={() => setPurgeRemovedOpen(true)}
                  className="mt-2 rounded-xl border border-red-400 bg-white px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-700 hover:text-white"
                >
                  {t.purgeRemovedButton}
                </button>
              </div>
              <div>
                <p className="text-[13px] leading-relaxed text-stone-600">{t.purgeAllHint}</p>
                <button
                  type="button"
                  onClick={() => setPurgeAllOpen(true)}
                  className="mt-2 rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800"
                >
                  {t.purgeAllButton}
                </button>
              </div>
            </div>
          )}
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

      <ConfirmDialog
        open={purgeRemovedOpen}
        title={t.purgeRemovedTitle}
        body={t.purgeConsequence}
        confirmLabel={t.purgeRemovedConfirm}
        cancelLabel={strings.void.cancel}
        requirePhrase={{ label: t.purgePhraseLabel, phrase: t.purgePhrase }}
        onConfirm={() => handlePurge('removed')}
        onCancel={() => setPurgeRemovedOpen(false)}
        busy={purging}
      />

      <ConfirmDialog
        open={purgeAllOpen}
        title={t.purgeAllTitle}
        body={t.purgeConsequence}
        confirmLabel={t.purgeAllConfirm}
        cancelLabel={strings.void.cancel}
        // A DIFFERENT phrase from the removed-only dialog on purpose: the two
        // buttons are adjacent, and a memorised phrase must not let a mis-tap
        // erase the whole ledger.
        requirePhrase={{ label: t.purgeAllPhraseLabel, phrase: t.purgeAllPhrase }}
        onConfirm={() => handlePurge('all')}
        onCancel={() => setPurgeAllOpen(false)}
        busy={purging}
      />
    </>
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-stone-400">{label}</dt>
      <dd className="font-medium text-stone-800">{value}</dd>
    </div>
  )
}

// Volunteer/collect wrapper (/collect/history) — the console owns the admin
// frame, so the wrapper only exists for the AppShell + bottom tab bar variant.
// An admin who reaches /collect/history gets AppShell here (no tab bar, since
// isVolunteer is false) — expected.
export function CollectionsScreen() {
  const { appUser } = useAuth()
  const isAdmin = isAdminRole(appUser?.role ?? '')
  const isVolunteer = appUser?.role === 'volunteer'
  const home = isAdmin
    ? { to: '/admin', label: strings.admin.dashboardTitle }
    : { to: '/collect', label: strings.collection.title }

  return (
    <AppShell title={t.title} back={home}>
      <CollectionsContent />
      {isVolunteer && (
        <>
          <div aria-hidden="true" className="h-16" />
          <VolunteerTabBar />
        </>
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
