import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { getDonations, getDonationsLite, type Donation, type DonationLite } from '../../lib/db/donations'
import { getDonationSources } from '../../lib/db/config'
import { voidRow, clearAllDonations, purgeDonations } from '../../lib/db/void'
import { fetchMandalUserNames } from '../../lib/db/users'
import { isAdminRole, isOwnerRole } from '../../lib/roles'
import { formatForDisplay, normalizeToE164, waDigits } from '../../lib/phone'
import { formatINR, formatPct } from '../../lib/money'
import {
  daysWithCollections,
  formatLocalDay,
  matchesWhen,
  totalsOf,
  type WhenFilter,
} from '../../lib/dayFilter'
import { matchesSource, sourceFilterOptions, sourceLabel } from '../../lib/sources'
import { strings } from '../../lib/strings'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Sheet } from '../../components/Sheet'
import { DayPickerSheet } from '../../components/DayPickerSheet'
import { AppShell } from '../../components/AppShell'
import { LetterAvatar, Money, SearchField, SheetHeader, Switch } from '../../components/console'
import { HowToSheet } from '../admin/HowToSheet'
import { VolunteerTabBar } from './VolunteerTabBar'
import {
  btnRow,
  btnRowGreen,
  ctaDanger,
  ctaInk,
  ctaQuiet,
  eyebrow,
  eyebrowOnDark,
  hero,
  infoRoundOnDark,
  moneyHero,
  pill,
  segButton,
  segTrack,
} from '../../components/ui'

const t = strings.collections

const MODE_LABEL: Record<string, string> = {
  cash: strings.collection.modeCash,
  upi: strings.collection.modeUpi,
  bank: strings.collection.modeBank,
}
const MODES = ['cash', 'upi', 'bank']
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--color-slot-${n})`)

const WHENS: WhenFilter[] = ['all', 'today', 'week', 'month']
const WHEN_LABEL: Record<WhenFilter, string> = {
  all: t.whenAll,
  today: t.whenToday,
  week: t.whenWeek,
  month: t.whenMonth,
  date: t.whenPickDate,
}

type Sort = 'recent' | 'amount' | 'name'
const SORTS: Sort[] = ['recent', 'amount', 'name']
const SORT_LABEL: Record<Sort, string> = { recent: t.sortRecent, amount: t.sortAmount, name: t.sortName }

// How many rows the list shows per "Load more" tap.
const PAGE = 20

// Every filter change routes through one patch type, so the sheet, the chips and
// the "clear filters" button all reset paging the same way.
type FilterPatch = {
  source?: string
  mode?: string
  when?: WhenFilter
  pickedDay?: string
  sort?: Sort
  showRemoved?: boolean
  search?: string
}

// Short, human timestamp for a row subline — "Today, 4:20 PM" for today,
// otherwise "2 Jan, 4:20 PM". Display-only; never feeds a total.
function shortTime(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === new Date().toDateString()) return `${t.dateFilterToday}, ${time}`
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`
}

// Full date+time for the detail sheet (the row subline stays terse).
function fullTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

const digitsOf = (s: string): string => s.replace(/\D/g, '')

// The search box: case-insensitive, trimmed match on the donor name, the
// receipt number (leading "#" tolerated, prefix match so it narrows as you
// type), the collector's name (admins — the names map is empty for a volunteer
// session), and the phone by raw digits. The phone match needs ≥4 digits: a 1–3
// digit query is a receipt number being typed, and matching it inside every
// phone would flood the list instead of narrowing it.
function matchesQuery(d: DonationLite, q: string, names: Record<string, string>): boolean {
  if (q === '') return true
  const receipt = q.replace(/^#/, '')
  const qDigits = digitsOf(q)
  return (
    d.donor_name.toLowerCase().includes(q) ||
    (receipt !== '' && String(d.receipt_no).startsWith(receipt)) ||
    (names[d.collected_by] ?? '').toLowerCase().includes(q) ||
    (qDigits.length >= 4 && digitsOf(d.donor_phone ?? '').includes(qDigits))
  )
}

// A donor is one person or shop, however many times they gave: keyed by phone
// digits when there is a phone, else by lowercased name. Same identity rule the
// donors_summary RPC used, moved client-side so search and filters narrow the
// donors view and the donations view together — the design's explicit promise
// ("the total always matches the view"). Built from the UNCAPPED lite rows, so a
// season past 1000 donations still groups completely.
type DonorGroup = {
  key: string
  name: string
  phone: string
  totalPaise: number
  count: number
  first: string
  last: string
  items: DonationLite[]
}

function groupDonors(rows: DonationLite[]): DonorGroup[] {
  const groups = new Map<string, DonorGroup>()
  for (const d of rows) {
    const phone = d.donor_phone ? normalizeToE164(d.donor_phone) : ''
    const key = phone ? digitsOf(phone) : d.donor_name.trim().toLowerCase()
    const g = groups.get(key) ?? {
      key,
      name: d.donor_name,
      phone,
      totalPaise: 0,
      count: 0,
      first: d.created_at,
      last: d.created_at,
      items: [],
    }
    g.totalPaise += d.amount_paise
    g.count += 1
    if (d.created_at < g.first) g.first = d.created_at
    if (d.created_at > g.last) g.last = d.created_at
    g.items.push(d)
    groups.set(key, g)
  }
  for (const g of groups.values()) g.items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  return [...groups.values()]
}

// SPEC.md's "my collections" (volunteer) / "all collections" (admin) screen.
// Content-only body: rendered inside AdminLayout's <Outlet/> at
// /admin/collections and /admin/donors (console frame) and inside the AppShell
// wrapper below at /collect/history (volunteer/collect flow). RLS on `donations`
// scopes the rows per-role server-side.
//
// Redesign 2026-08-18: the design merges the old separate Donors page in as a
// second VIEW of the same money — one filtered set, read either as receipts or
// as people — with a filter-aware total on top, all filters behind one sheet,
// each row's detail in a sheet, and the danger zone behind "Data cleanup".
export function CollectionsContent({ initialView = 'donations' }: { initialView?: 'donations' | 'donors' }) {
  const { appUser } = useAuth()
  const [donations, setDonations] = useState<Donation[]>([])
  // The same rows in lite shape but UNCAPPED (getDonations stops at 1000), so
  // the hero total and the donors view never undercount even when the list
  // itself is capped. Best-effort: null when that fetch failed, and then the
  // hero simply isn't shown — the list must never blank because its totals
  // couldn't load, and the total must never silently fall back to capped-list
  // figures.
  const [lite, setLite] = useState<DonationLite[] | null>(null)
  // collected_by (a users.id) → display name; admin-only server-side, so a
  // volunteer session just gets {} and every collector falls back to "Unknown".
  const [names, setNames] = useState<Record<string, string>>({})
  const [sources, setSources] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [view, setView] = useState(initialView)
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('all')
  const [mode, setMode] = useState('all')
  const [when, setWhen] = useState<WhenFilter>('all')
  const [pickedDay, setPickedDay] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [showRemoved, setShowRemoved] = useState(false)
  const [page, setPage] = useState(1)

  const [sheet, setSheet] = useState<'filters' | 'picker' | 'cleanup' | 'howto' | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [donorKey, setDonorKey] = useState<string | null>(null)
  // The row being deleted is held separately from the row being VIEWED, so
  // opening the confirm closes the detail sheet instead of stacking a second
  // modal over it — two dimmed layers on a 360px screen is a trap, not a flow.
  const [voidTarget, setVoidTarget] = useState<Donation | null>(null)
  const [confirm, setConfirm] = useState<'clear' | 'purgeRemoved' | 'purgeAll' | null>(null)
  const [busy, setBusy] = useState(false)

  function load() {
    return Promise.all([getDonations(), getDonationsLite().catch((): null => null)]).then(([d, l]) => {
      setDonations(d)
      setLite(l)
    })
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
    // Both best-effort: names power the "collected by" line (empty for a
    // volunteer), sources order the hero's split.
    fetchMandalUserNames()
      .then((n) => {
        if (active) setNames(n)
      })
      .catch(() => {})
    getDonationSources()
      .then((s) => {
        if (active) setSources(s)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const isAdmin = isAdminRole(appUser?.role ?? '')
  const isOwner = isOwnerRole(appUser?.role ?? '')

  // ONE predicate for every filter, applied to both the capped list rows and the
  // uncapped lite rows, so the total on top always describes exactly the view
  // below it.
  const q = search.trim().toLowerCase()
  const matches = useMemo(
    () => (d: DonationLite) =>
      matchesSource(d.category, source) &&
      (mode === 'all' || d.mode === mode) &&
      matchesWhen(d.created_at, when, pickedDay) &&
      matchesQuery(d, q, names),
    [source, mode, when, pickedDay, q, names],
  )

  const filtered = donations.filter(matches)
  const removedCount = filtered.filter((d) => d.voided).length
  const listed = showRemoved ? filtered : filtered.filter((d) => !d.voided)
  const rows = [...listed].sort((a, b) =>
    sort === 'amount'
      ? b.amount_paise - a.amount_paise
      : sort === 'name'
        ? a.donor_name.localeCompare(b.donor_name)
        : 0,
  )

  const liteFiltered = lite === null ? null : lite.filter(matches)
  const liteLive = liteFiltered?.filter((d) => !d.voided) ?? null
  const totals = liteFiltered === null ? null : totalsOf(liteFiltered)
  const donors = useMemo(() => {
    if (liteLive === null) return []
    const list = groupDonors(liteLive)
    return list.sort((a, b) =>
      sort === 'amount'
        ? b.totalPaise - a.totalPaise
        : sort === 'name'
          ? a.name.localeCompare(b.name)
          : a.last < b.last
            ? 1
            : -1,
    )
    // liteLive is derived; depending on the inputs that produce it is what keeps
    // this memo honest without re-grouping on every unrelated render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lite, matches, sort])

  const onDonations = view === 'donations'
  const total = onDonations ? rows.length : donors.length
  const shown = Math.min(page * PAGE, total)
  const unit = onDonations ? t.donationsUnit(total) : t.donorsUnit(total)

  // Active-filter chips: each one clears exactly what it names, so a narrowed
  // view is always visibly narrowed and always one tap from wider.
  const chips: { label: string; clear: () => void }[] = []
  if (source !== 'all') chips.push({ label: source, clear: () => reset({ source: 'all' }) })
  if (mode !== 'all') chips.push({ label: MODE_LABEL[mode] ?? mode, clear: () => reset({ mode: 'all' }) })
  if (when !== 'all')
    chips.push({
      label: when === 'date' && pickedDay ? shortDate(`${pickedDay}T12:00:00`) : WHEN_LABEL[when],
      clear: () => reset({ when: 'all' }),
    })
  if (sort !== 'recent') chips.push({ label: SORT_LABEL[sort], clear: () => reset({ sort: 'recent' }) })
  if (showRemoved) chips.push({ label: t.inclRemovedChip, clear: () => reset({ showRemoved: false }) })

  // Any filter change resets paging: keeping page 3 after narrowing to 4 rows
  // shows an empty list under a "Showing 60 of 4" pager.
  function reset(patch: FilterPatch) {
    if (patch.source !== undefined) setSource(patch.source)
    if (patch.mode !== undefined) setMode(patch.mode)
    if (patch.when !== undefined) setWhen(patch.when)
    if (patch.pickedDay !== undefined) setPickedDay(patch.pickedDay)
    if (patch.sort !== undefined) setSort(patch.sort)
    if (patch.showRemoved !== undefined) setShowRemoved(patch.showRemoved)
    if (patch.search !== undefined) setSearch(patch.search)
    setPage(1)
  }

  function resetAll() {
    reset({ source: 'all', mode: 'all', when: 'all', pickedDay: '', sort: 'recent', showRemoved: false, search: '' })
  }

  const selected = donations.find((d) => d.id === selectedId) ?? null
  const donor = donors.find((g) => g.key === donorKey) ?? null

  // Every destructive action ends the same way: reload, report, and put the
  // confirm away whether it succeeded or failed.
  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      await load()
      if (done) setNotice(done)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setConfirm(null)
      setVoidTarget(null)
    }
  }

  // Asking for confirmation closes the cleanup sheet first, for the same reason
  // the detail sheet closes before its confirm.
  function ask(which: 'clear' | 'purgeRemoved' | 'purgeAll') {
    setSheet(null)
    setConfirm(which)
  }

  const sourceOptions = sourceFilterOptions(
    sources,
    (lite ?? donations).map((d) => d.category),
  )

  return (
    <>
      <TotalHero
        totals={totals}
        donorCount={donors.length}
        rows={liteLive}
        sourceOptions={sourceOptions}
        scope={[
          WHEN_LABEL[when],
          ...(source !== 'all' ? [source] : []),
          ...(mode !== 'all' ? [MODE_LABEL[mode] ?? mode] : []),
        ].join(' · ')}
        onHowTo={() => setSheet('howto')}
      />

      <div className={segTrack}>
        <button type="button" aria-pressed={onDonations} onClick={() => setView('donations')} className={segButton(onDonations)}>
          {t.segDonations} · {rows.length}
        </button>
        <button
          type="button"
          aria-pressed={!onDonations}
          onClick={() => setView('donors')}
          className={segButton(!onDonations)}
        >
          {t.segDonors} · {donors.length}
        </button>
      </div>

      <div className="flex gap-[7px]">
        <SearchField
          value={search}
          onChange={(v) => reset({ search: v })}
          placeholder={onDonations ? t.searchPlaceholder : t.searchPlaceholderDonors}
        />
        <button
          type="button"
          onClick={() => setSheet('filters')}
          className={`h-10 flex-none rounded-xl border px-3.5 text-[12.5px] font-bold ${
            chips.length > 0
              ? 'border-stone-900 bg-stone-900 text-white'
              : 'border-stone-200 bg-white text-stone-700'
          }`}
        >
          {t.filtersButton}
          {chips.length > 0 ? ` · ${chips.length}` : ''}
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setSheet('cleanup')}
            aria-label={t.dataCleanup}
            className="flex h-10 w-10 flex-none flex-col items-center justify-center gap-[3px] rounded-xl border border-stone-200 bg-white text-stone-500 transition-colors hover:border-stone-900 hover:text-stone-900"
          >
            <span aria-hidden="true" className="block h-[3.5px] w-[3.5px] rounded-full bg-current" />
            <span aria-hidden="true" className="block h-[3.5px] w-[3.5px] rounded-full bg-current" />
            <span aria-hidden="true" className="block h-[3.5px] w-[3.5px] rounded-full bg-current" />
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={c.clear}
              className="flex h-7 items-center gap-1.5 rounded-full bg-stone-900 px-2.5 text-[11.5px] font-semibold text-white"
            >
              {c.label}
              <span aria-hidden="true" className="opacity-55">
                ✕
              </span>
            </button>
          ))}
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
      ) : total === 0 ? (
        /* Filtered to nothing — NOT the same as "no donations yet". Showing the
           empty-ledger copy here reads as data loss, which is alarming when a
           permanent purge is two taps away. */
        <div className="rounded-[16px] border border-dashed border-stone-200 bg-stone-50 px-4 py-6 text-center">
          <p className="text-[13.5px] font-bold text-stone-600">{t.noResultsTitle}</p>
          <p className="mt-0.5 text-[11.5px] font-medium text-stone-400">{t.noResultsBody}</p>
          <button type="button" onClick={resetAll} className={`mx-auto mt-3 w-fit px-3.5 ${ctaInk} h-[34px]`}>
            {t.clearFilters}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {onDonations
            ? rows.slice(0, shown).map((d) => (
                <DonationRow key={d.id} donation={d} onOpen={() => setSelectedId(d.id)} />
              ))
            : donors.slice(0, shown).map((g) => (
                <DonorRow key={g.key} donor={g} onOpen={() => setDonorKey(g.key)} />
              ))}
        </div>
      )}

      {total > 0 &&
        (shown < total ? (
          <div className="flex items-center gap-2.5">
            <span className="flex-1 text-[11.5px] font-semibold text-stone-400">{t.pagerShowing(shown, total, unit)}</span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              className="h-[38px] flex-none rounded-xl border border-stone-200 bg-white px-4 text-[12.5px] font-bold text-stone-700 transition-colors hover:border-stone-900"
            >
              {strings.app.loadMore}
            </button>
          </div>
        ) : (
          total > PAGE && <p className="text-center text-[11px] font-semibold text-faint">{t.pagerAll(total, unit)}</p>
        ))}

      <FiltersSheet
        open={sheet === 'filters'}
        onClose={() => setSheet(null)}
        sourceOptions={sourceOptions}
        source={source}
        mode={mode}
        when={when}
        pickedDay={pickedDay}
        sort={sort}
        showRemoved={showRemoved}
        removedCount={removedCount}
        resultLabel={unit}
        onChange={reset}
        onResetAll={resetAll}
        onPickDate={() => setSheet('picker')}
      />

      <DayPickerSheet
        open={sheet === 'picker'}
        onClose={() => setSheet('filters')}
        selected={pickedDay}
        markedDays={daysWithCollections(lite ?? [])}
        today={formatLocalDay(new Date())}
        onPick={(day) => {
          reset({ when: 'date', pickedDay: day })
          setSheet(null)
        }}
      />

      <DetailSheet
        donation={selected}
        collectedBy={selected ? (names[selected.collected_by] ?? t.unknownCollector) : ''}
        onClose={() => setSelectedId(null)}
        onDelete={() => {
          setVoidTarget(selected)
          setSelectedId(null)
        }}
      />

      <DonorSheet donor={donor} onClose={() => setDonorKey(null)} />

      {isAdmin && (
        <CleanupSheet
          open={sheet === 'cleanup'}
          onClose={() => setSheet(null)}
          isOwner={isOwner}
          hasActive={donations.some((d) => !d.voided)}
          onClearAll={() => ask('clear')}
          onPurgeRemoved={() => ask('purgeRemoved')}
          onPurgeAll={() => ask('purgeAll')}
        />
      )}

      <HowToSheet tab="collections" open={sheet === 'howto'} onClose={() => setSheet(null)} />

      <ConfirmDialog
        open={voidTarget !== null}
        title={t.deleteTitle}
        body={t.deleteBody}
        confirmLabel={t.deleteConfirm}
        cancelLabel={strings.void.cancel}
        reason={{ label: t.deleteReasonLabel, placeholder: t.deleteReasonPlaceholder }}
        onConfirm={(reason) => {
          const id = voidTarget?.id
          if (!id) return
          void run(() => voidRow('donations', id, reason || strings.void.defaultReason))
        }}
        onCancel={() => setVoidTarget(null)}
        busy={busy}
      />

      <ConfirmDialog
        open={confirm === 'clear'}
        title={t.clearAllTitle}
        body={t.clearAllBody}
        confirmLabel={t.clearAllConfirm}
        cancelLabel={strings.void.cancel}
        reason={{ label: t.clearAllReasonLabel, placeholder: t.clearAllReasonPlaceholder }}
        requirePhrase={{ label: t.clearAllPhraseLabel, phrase: t.clearAllPhrase }}
        onConfirm={(reason) => void run(() => clearAllDonations(reason), t.cleared)}
        onCancel={() => setConfirm(null)}
        busy={busy}
      />

      <ConfirmDialog
        open={confirm === 'purgeRemoved'}
        title={t.purgeRemovedTitle}
        body={t.purgeConsequence}
        confirmLabel={t.purgeRemovedConfirm}
        cancelLabel={strings.void.cancel}
        requirePhrase={{ label: t.purgePhraseLabel, phrase: t.purgePhrase }}
        onConfirm={() => void run(() => purgeDonations('removed'), t.purgedRemovedNotice)}
        onCancel={() => setConfirm(null)}
        busy={busy}
      />

      <ConfirmDialog
        open={confirm === 'purgeAll'}
        title={t.purgeAllTitle}
        body={t.purgeConsequence}
        confirmLabel={t.purgeAllConfirm}
        cancelLabel={strings.void.cancel}
        // A DIFFERENT phrase from the removed-only dialog on purpose: the two
        // buttons sit side by side, and a memorised phrase must not let a
        // mis-tap erase the whole ledger.
        requirePhrase={{ label: t.purgeAllPhraseLabel, phrase: t.purgeAllPhrase }}
        onConfirm={() => void run(() => purgeDonations('all'), t.purgedAllNotice)}
        onCancel={() => setConfirm(null)}
        busy={busy}
      />
    </>
  )
}

// The filter-aware total. "Never the whole season unless the filters say so" is
// the design's promise, so the scope line spells out exactly what is being
// summed, and the split below is by the mandal's own sources.
function TotalHero({
  totals,
  donorCount,
  rows,
  sourceOptions,
  scope,
  onHowTo,
}: {
  totals: { totalPaise: number; count: number } | null
  donorCount: number
  rows: DonationLite[] | null
  sourceOptions: string[]
  scope: string
  onHowTo: () => void
}) {
  if (totals === null || rows === null) return null
  const bySource = new Map<string, number>(sourceOptions.map((s) => [s, 0]))
  for (const d of rows) {
    const label = sourceLabel(d.category)
    bySource.set(label, (bySource.get(label) ?? 0) + d.amount_paise)
  }
  const live = rows.reduce((sum, d) => sum + d.amount_paise, 0)
  const split = [...bySource.entries()].filter(([, paise]) => paise > 0).sort((a, b) => b[1] - a[1])
  const average = totals.count > 0 ? Math.round(totals.totalPaise / totals.count) : 0

  return (
    <div className={hero}>
      <div className="flex items-baseline gap-2">
        <span className={eyebrowOnDark}>{t.totalEyebrow}</span>
        <span className="flex-1" />
        <span className="text-[10.5px] font-semibold text-stone-500">{scope}</span>
        <button
          type="button"
          onClick={onHowTo}
          aria-label={strings.admin.howToEyebrow}
          className={`${infoRoundOnDark} -mt-0.5 h-[26px] w-[26px] text-xs`}
        >
          i
        </button>
      </div>
      <p className={`${moneyHero} mt-1 mb-0.5`}>
        <Money paise={totals.totalPaise} decClassName="text-[19px] text-stone-400" />
      </p>
      <p className="text-[11.5px] font-medium text-stone-400">
        {t.summaryLine(t.donationsUnit(totals.count), t.donorsUnit(donorCount), formatINR(average))}
      </p>

      {split.length > 0 && (
        <>
          <div aria-hidden="true" className="mt-3 mb-2 flex h-[5px] overflow-hidden rounded-full bg-white/12">
            {split.map(([name, paise], i) => (
              <span key={name} style={{ width: formatPct(paise, live), backgroundColor: SLOTS[i % SLOTS.length] }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[10.5px] font-semibold text-stone-400">
            {split.map(([name, paise], i) => (
              <span key={name} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-[7px] w-[7px] rounded-full"
                  style={{ backgroundColor: SLOTS[i % SLOTS.length] }}
                />
                {name} {formatPct(paise, live)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function DonationRow({ donation, onOpen }: { donation: Donation; onOpen: () => void }) {
  const dead = donation.voided
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-start gap-[11px] rounded-[16px] border p-[13px] text-left ${
        dead
          ? 'border-dashed border-stone-200 bg-stone-50'
          : 'border-stone-200 bg-white shadow-[0_1px_2px_rgba(28,25,23,.04)] transition-colors hover:border-stone-300'
      }`}
    >
      {/* The design's mode mark: the mode's own name in uppercase, not an icon. */}
      <span
        className={`flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border text-[9.5px] font-bold tracking-[0.06em] ${
          dead ? 'border-hairline bg-stone-100 text-stone-300' : 'border-hairline bg-stone-50 text-stone-500'
        }`}
      >
        {(MODE_LABEL[donation.mode] ?? donation.mode).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-bold ${dead ? 'text-stone-400 line-through' : 'text-stone-900'}`}
        >
          {donation.donor_name}
        </span>
        <span className={`mt-0.5 block text-[11.5px] font-medium ${dead ? 'text-faint' : 'text-stone-400'}`}>
          {t.receiptPrefix}
          {donation.receipt_no} · {MODE_LABEL[donation.mode] ?? donation.mode} · {shortTime(donation.created_at)}
        </span>
        <span
          className={`mt-1.5 inline-block rounded-full bg-stone-100 px-2 py-0.5 text-[10.5px] font-semibold ${
            dead ? 'text-stone-400' : 'text-stone-600'
          }`}
        >
          {dead ? `${t.removedChipPrefix}${donation.void_reason ?? ''}` : sourceLabel(donation.category)}
        </span>
      </span>
      <Money
        paise={donation.amount_paise}
        className={`flex-none text-[15px] font-bold tabular-nums ${dead ? 'text-faint line-through' : 'text-stone-900'}`}
        decClassName={dead ? '' : 'text-stone-400'}
      />
    </button>
  )
}

function DonorRow({ donor, onOpen }: { donor: DonorGroup; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-[11px] rounded-[16px] border border-stone-200 bg-white p-[13px] text-left shadow-[0_1px_2px_rgba(28,25,23,.04)] transition-colors hover:border-stone-300"
    >
      <LetterAvatar name={donor.name} size={38} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-stone-900">{donor.name}</span>
        <span className="mt-0.5 block text-[11.5px] font-medium text-stone-400">
          {t.donorFirstLastMeta(shortDate(donor.first), shortDate(donor.last))}
        </span>
      </span>
      <span className="flex-none text-right">
        <Money paise={donor.totalPaise} className="block text-[15px] font-bold tabular-nums" />
        <span className="block text-[11px] font-medium text-stone-400">{t.donationsUnit(donor.count)}</span>
      </span>
    </button>
  )
}

function FiltersSheet({
  open,
  onClose,
  sourceOptions,
  source,
  mode,
  when,
  pickedDay,
  sort,
  showRemoved,
  removedCount,
  resultLabel,
  onChange,
  onResetAll,
  onPickDate,
}: {
  open: boolean
  onClose: () => void
  sourceOptions: string[]
  source: string
  mode: string
  when: WhenFilter
  pickedDay: string
  sort: Sort
  showRemoved: boolean
  removedCount: number
  resultLabel: string
  onChange: (patch: FilterPatch) => void
  onResetAll: () => void
  onPickDate: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="filters-sheet-title">
      <div className="flex items-center gap-2.5">
        <h2
          id="filters-sheet-title"
          className="font-display flex-1 text-lg font-extrabold tracking-[-0.02em] text-stone-900"
        >
          {t.filterSheetTitle}
        </h2>
        <button type="button" onClick={onClose} aria-label={strings.app.close} className="text-stone-500">
          ✕
        </button>
      </div>

      <p className={`${eyebrow} mt-[18px] mb-2`}>{t.groupSource}</p>
      <div role="group" aria-label={t.groupSource} className="flex flex-wrap gap-[7px]">
        <button type="button" aria-pressed={source === 'all'} onClick={() => onChange({ source: 'all' })} className={pill(source === 'all')}>
          {strings.app.all}
        </button>
        {sourceOptions.map((s) => (
          <button key={s} type="button" aria-pressed={source === s} onClick={() => onChange({ source: s })} className={pill(source === s)}>
            {s}
          </button>
        ))}
      </div>

      <p className={`${eyebrow} mt-4 mb-2`}>{t.groupMode}</p>
      <div role="group" aria-label={t.groupMode} className="flex flex-wrap gap-[7px]">
        <button type="button" aria-pressed={mode === 'all'} onClick={() => onChange({ mode: 'all' })} className={pill(mode === 'all')}>
          {strings.app.all}
        </button>
        {MODES.map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => onChange({ mode: m })} className={pill(mode === m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <p className={`${eyebrow} mt-4 mb-2`}>{t.groupWhen}</p>
      <div role="group" aria-label={t.groupWhen} className="flex flex-wrap gap-[7px]">
        {WHENS.map((w) => (
          <button key={w} type="button" aria-pressed={when === w} onClick={() => onChange({ when: w })} className={pill(when === w)}>
            {WHEN_LABEL[w]}
          </button>
        ))}
        <button type="button" aria-pressed={when === 'date'} onClick={onPickDate} className={pill(when === 'date')}>
          {when === 'date' && pickedDay ? shortDate(`${pickedDay}T12:00:00`) : t.whenPickDate}
        </button>
      </div>

      <p className={`${eyebrow} mt-4 mb-2`}>{t.groupSort}</p>
      <div role="group" aria-label={t.groupSort} className="flex flex-wrap gap-[7px]">
        {SORTS.map((s) => (
          <button key={s} type="button" aria-pressed={sort === s} onClick={() => onChange({ sort: s })} className={pill(sort === s)}>
            {SORT_LABEL[s]}
          </button>
        ))}
      </div>

      {/* Hidden when there is nothing removed to show: a toggle that can only
          reveal an empty set is a question with one answer. */}
      {(removedCount > 0 || showRemoved) && (
        <button
          type="button"
          aria-pressed={showRemoved}
          onClick={() => onChange({ showRemoved: !showRemoved })}
          className="mt-[18px] flex w-full items-center gap-[11px] rounded-[14px] border border-hairline bg-stone-50 px-[13px] py-3 text-left"
        >
          <span className="flex-1">
            <span className="block text-[13px] font-bold text-stone-800">{t.showRemovedTitle}</span>
            <span className="mt-px block text-[11px] font-medium text-stone-400">{t.showRemovedHint}</span>
          </span>
          <Switch on={showRemoved} />
        </button>
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onResetAll} className={`${ctaQuiet} w-auto flex-none px-4`}>
          {strings.app.reset}
        </button>
        <button type="button" onClick={onClose} className={`${ctaInk} h-[46px] flex-1`}>
          {t.showResults(resultLabel)}
        </button>
      </div>
    </Sheet>
  )
}

// A donation's detail. Deliberately NO "edit": donations are append-only
// (forbid_financial_edit), so a wrong figure is a delete plus a re-entry, and
// the copy says exactly that rather than offering an edit the DB would refuse.
function DetailSheet({
  donation,
  collectedBy,
  onClose,
  onDelete,
}: {
  donation: Donation | null
  collectedBy: string
  onClose: () => void
  onDelete: () => void
}) {
  const [copied, setCopied] = useState(false)
  if (!donation) return null
  const phone = donation.donor_phone ? normalizeToE164(donation.donor_phone) : ''
  const receiptPath = `/r/${donation.receipt_no}-${donation.public_token}`

  return (
    <Sheet open onClose={onClose} labelledBy="donation-detail-title">
      <SheetHeader
        title={donation.donor_name}
        titleId="donation-detail-title"
        hint={`${t.receiptPrefix}${donation.receipt_no} · ${fullTime(donation.created_at)}`}
        onClose={onClose}
        closeLabel={strings.app.close}
      />

      <p className="font-display mt-3 mb-0.5 text-[34px] font-extrabold tracking-[-0.03em] tabular-nums">
        <Money paise={donation.amount_paise} decClassName="text-[19px] text-stone-400" />
      </p>
      <div className="mt-2 flex gap-1.5">
        <span className="rounded-full bg-stone-100 px-2.5 py-[3px] text-[11px] font-semibold text-stone-600">
          {MODE_LABEL[donation.mode] ?? donation.mode}
        </span>
        <span className="rounded-full bg-stone-100 px-2.5 py-[3px] text-[11px] font-semibold text-stone-600">
          {sourceLabel(donation.category)}
        </span>
      </div>

      {phone && (
        <div className="mt-4 flex items-center gap-2 border-t border-stone-100 pt-3.5">
          <a href={`tel:${phone}`} className="flex-1 text-[13px] font-semibold tabular-nums text-stone-800">
            {formatForDisplay(phone)}
          </a>
          <a href={`tel:${phone}`} className={btnRow}>
            {strings.app.call}
          </a>
          <a href={`https://wa.me/${waDigits(phone)}`} target="_blank" rel="noopener noreferrer" className={btnRowGreen}>
            {strings.app.whatsApp}
          </a>
        </div>
      )}

      <dl className="mt-3.5 grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-hairline bg-stone-50 px-[11px] py-2.5">
          <dt className="text-[9.5px] font-bold tracking-[0.12em] text-stone-400 uppercase">{t.detailCollectedBy}</dt>
          <dd className="mt-0.5 text-[13px] font-bold">{collectedBy}</dd>
        </div>
        <div className="rounded-xl border border-hairline bg-stone-50 px-[11px] py-2.5">
          <dt className="text-[9.5px] font-bold tracking-[0.12em] text-stone-400 uppercase">{t.detailDate}</dt>
          <dd className="mt-0.5 text-[13px] font-bold">{shortDate(donation.created_at)}</dd>
        </div>
      </dl>

      <div className="mt-3.5 flex gap-2">
        <a
          href={receiptPath}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-[42px] flex-1 items-center justify-center rounded-xl border border-stone-200 bg-white text-[12.5px] font-bold text-stone-700 transition-colors hover:border-stone-900"
        >
          {t.detailOpenReceipt}
        </a>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(`${window.location.origin}${receiptPath}`)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          className="h-[42px] flex-1 rounded-xl border border-stone-200 bg-white text-[12.5px] font-bold text-stone-700 transition-colors hover:border-stone-900"
        >
          {copied ? t.detailCopied : t.detailCopyLink}
        </button>
      </div>

      {donation.voided ? (
        <p className="mt-2.5 rounded-xl border border-dashed border-stone-200 bg-stone-50 px-[13px] py-3 text-xs font-semibold text-stone-500">
          {t.removedAuditNote(donation.void_reason ?? '')}
        </p>
      ) : (
        <button type="button" onClick={onDelete} className={`mt-2 ${ctaDanger}`}>
          {t.deleteConfirm}
        </button>
      )}
    </Sheet>
  )
}

function DonorSheet({ donor, onClose }: { donor: DonorGroup | null; onClose: () => void }) {
  if (!donor) return null
  return (
    <Sheet open onClose={onClose} labelledBy="donor-detail-title">
      <SheetHeader
        title={donor.name}
        titleId="donor-detail-title"
        hint={t.donorFirstLastMeta(shortDate(donor.first), shortDate(donor.last))}
        onClose={onClose}
        closeLabel={strings.app.close}
      >
        <LetterAvatar name={donor.name} size={44} />
      </SheetHeader>

      <div className="mt-3.5 flex items-baseline gap-2.5 rounded-[14px] border border-hairline bg-stone-50 p-[13px]">
        <div className="flex-1">
          <p className="text-[9.5px] font-bold tracking-[0.12em] text-stone-400 uppercase">{t.donorGivenTotal}</p>
          <p className="font-display mt-0.5 text-[25px] font-extrabold tracking-[-0.02em] tabular-nums">
            <Money paise={donor.totalPaise} decClassName="text-[15px] text-stone-400" />
          </p>
        </div>
        <p className="text-[11.5px] font-semibold text-stone-500">{t.donationsUnit(donor.count)}</p>
      </div>

      {donor.phone ? (
        <div className="mt-3 flex items-center gap-2">
          <a href={`tel:${donor.phone}`} className="flex-1 text-[13px] font-semibold tabular-nums text-stone-800">
            {formatForDisplay(donor.phone)}
          </a>
          <a href={`tel:${donor.phone}`} className={btnRow}>
            {strings.app.call}
          </a>
          <a
            href={`https://wa.me/${waDigits(donor.phone)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={btnRowGreen}
          >
            {strings.app.whatsApp}
          </a>
        </div>
      ) : (
        <p className="mt-3 text-xs font-medium text-stone-400">{t.donorNoPhoneNote}</p>
      )}

      <p className={`${eyebrow} mt-[18px] mb-1`}>{t.donorHistoryTitle}</p>
      <ul className="flex flex-col">
        {donor.items.map((d) => (
          <li key={`${d.receipt_no}`} className="flex items-baseline gap-2.5 border-t border-stone-100 py-2.5">
            <span className="min-w-0 flex-1 text-[12.5px] font-medium text-stone-600">
              {shortDate(d.created_at)} · {MODE_LABEL[d.mode] ?? d.mode} · {sourceLabel(d.category)}
            </span>
            <Money paise={d.amount_paise} className="flex-none text-[13px] font-bold tabular-nums" />
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

// The danger zone, moved off the bottom of the list and behind an explicit
// affordance: it used to sit directly under the rows, one scroll from a mis-tap.
function CleanupSheet({
  open,
  onClose,
  isOwner,
  hasActive,
  onClearAll,
  onPurgeRemoved,
  onPurgeAll,
}: {
  open: boolean
  onClose: () => void
  isOwner: boolean
  hasActive: boolean
  onClearAll: () => void
  onPurgeRemoved: () => void
  onPurgeAll: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="cleanup-sheet-title">
      <SheetHeader
        title={t.dataCleanup}
        titleId="cleanup-sheet-title"
        hint={t.cleanupHint}
        onClose={onClose}
        closeLabel={strings.app.close}
      />

      {hasActive && (
        <div className="mt-4 rounded-[14px] border border-hairline p-[13px]">
          <p className="text-[13px] font-bold">{t.clearAllButton}</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-stone-500">{t.clearAllHint}</p>
          <button
            type="button"
            onClick={onClearAll}
            className="mt-2.5 h-[38px] rounded-[11px] border border-stone-200 bg-white px-3.5 text-[12.5px] font-bold text-stone-700 transition-colors hover:border-stone-900"
          >
            {t.clearAllButton}
          </button>
        </div>
      )}

      {isOwner && (
        <div className="mt-2.5 rounded-[14px] border border-red-200 bg-danger-tint p-[13px]">
          <p className="text-[9.5px] font-bold tracking-[0.14em] text-red-600 uppercase">{t.cleanupPermanentTag}</p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-stone-500">{t.purgeRemovedHint}</p>
          <button
            type="button"
            onClick={onPurgeRemoved}
            className="mt-2 h-[38px] rounded-[11px] border border-red-200 bg-white px-3.5 text-[12.5px] font-bold text-red-600 transition-colors hover:bg-red-50"
          >
            {t.purgeRemovedButton}
          </button>
          <p className="mt-3 text-[11.5px] leading-relaxed text-stone-500">{t.purgeAllHint}</p>
          <button
            type="button"
            onClick={onPurgeAll}
            className="mt-2 h-[38px] rounded-[11px] bg-red-700 px-3.5 text-[12.5px] font-bold text-white transition-colors hover:bg-red-800"
          >
            {t.purgeAllButton}
          </button>
        </div>
      )}

      <p className="mt-3 text-[11px] font-medium text-stone-400">{t.cleanupPhraseNote}</p>
    </Sheet>
  )
}

// Volunteer/collect wrapper (/collect/history) — the console owns the admin
// frame, so the wrapper only exists for the AppShell + bottom tab bar variant.
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

// The donors view of the same money, reached at /admin/donors — kept as a live
// URL (old bookmarks, the pre-redesign nav) even though the design merges it
// into the Collections tab's segmented switch.
export function DonorsContent() {
  return <CollectionsContent initialView="donors" />
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[16px] border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
      {message}
    </div>
  )
}
