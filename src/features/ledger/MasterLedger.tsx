import { useEffect, useState, type ReactNode } from 'react'
import { fetchFullLedger, fetchActiveVolunteers, type VolunteerSummary } from '../../lib/db/ledger'
import { getExpenses, type Expense } from '../../lib/db/expenses'
import { getDonationsLite, type DonationLite } from '../../lib/db/donations'
import { getDonationSources } from '../../lib/db/config'
import { fetchMandalUserNames } from '../../lib/db/users'
import { daysWithCollections, formatLocalDay, parseLocalDay, summarizeDay, type DaySummary } from '../../lib/dayFilter'
import { normalizeToE164 } from '../../lib/phone'
import { sourceFilterOptions, sourceLabel } from '../../lib/sources'
import { SLOT_COLORS, SLOT_REST, slotColor } from '../../lib/chartColors'
import {
  totalCollected,
  totalExpenses,
  netBalance,
  booksBalanceCheck,
  volunteerCashInHand,
  cashHeldByTreasurer,
  bankBalance,
  type Ledger,
  type BooksBalanceResult,
} from '../../lib/reconcile'
import { formatINR, formatPct } from '../../lib/money'
import { strings } from '../../lib/strings'
import { Sheet } from '../../components/Sheet'
import { DayPickerSheet } from '../../components/DayPickerSheet'
import { Bar, LetterAvatar, Money, SheetHeader } from '../../components/console'
import { FundDonut, type DonutSegment } from '../../components/FundDonut'
import { eyebrow, eyebrowOnDark, hero, infoRoundOnDark, moneyHero, panel, panelTitle } from '../../components/ui'

const t = strings.ledger

// The Ledger drops the expense category (reconcile.ts only needs amount/mode),
// so the "where the money went" pie is built from the admin-scoped getExpenses
// rows instead — same RLS scope as the ledger, just carrying the category.
function toExpenseSegments(expenses: Expense[]): DonutSegment[] {
  const byCategory = new Map<string, number>()
  for (const e of expenses) {
    if (e.voided) continue
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount_paise)
  }
  const sorted = [...byCategory.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((x, y) => y.value - x.value)
  const head = sorted.slice(0, SLOT_COLORS.length)
  const rest = sorted.slice(SLOT_COLORS.length)
  const segments: DonutSegment[] = head.map((c, i) => ({ name: c.name, value: c.value, color: slotColor(i) }))
  const otherTotal = rest.reduce((sum, c) => sum + c.value, 0)
  if (otherTotal > 0) segments.push({ name: strings.transparency.otherCategory, value: otherTotal, color: SLOT_REST })
  return segments
}

// The admin dashboard body — routed at "/admin" inside AdminLayout's <Outlet/>,
// which supplies the console frame (header + pill tabs + Collect FAB).
// fetchFullLedger()/fetchActiveVolunteers()/getExpenses() are all admin-only at
// the RLS level and mandal-scoped, so this only ever sums this mandal's books.
// Donations come from getDonationsLite — uncapped, so the source/insight/day
// figures can't undercount a big season the way the 1000-row list query would.
export function MasterLedgerContent() {
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [volunteers, setVolunteers] = useState<VolunteerSummary[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [donations, setDonations] = useState<DonationLite[]>([])
  // collected_by → display name for the per-volunteer day breakdown; every
  // user in the mandal (active or not), best-effort like Collections.tsx.
  const [names, setNames] = useState<Record<string, string>>({})
  // The mandal's own source list, so "where the money came from" leads with the
  // sources it uses today and still shows any a donation was recorded under.
  const [sources, setSources] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([
      fetchFullLedger(),
      fetchActiveVolunteers(),
      getExpenses(),
      getDonationsLite(),
      fetchMandalUserNames().catch((): Record<string, string> => ({})),
      getDonationSources().catch((): string[] => []),
    ])
      .then(([l, v, e, d, n, s]) => {
        if (!active) return
        setLedger(l)
        setVolunteers(v)
        setExpenses(e)
        setDonations(d)
        setNames(n)
        setSources(s)
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

  return (
    <>
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <DashboardSkeleton />
      ) : (
        ledger && (
          <Dashboard
            ledger={ledger}
            volunteers={volunteers}
            expenses={expenses}
            donations={donations}
            names={names}
            sources={sources}
          />
        )
      )}
    </>
  )
}

function Dashboard({
  ledger,
  volunteers,
  expenses,
  donations,
  names,
  sources,
}: {
  ledger: Ledger
  volunteers: VolunteerSummary[]
  expenses: Expense[]
  donations: DonationLite[]
  names: Record<string, string>
  sources: string[]
}) {
  const donationCount = ledger.donations.filter((d) => !d.voided).length
  const paymentCount = ledger.expenses.filter((e) => !e.voided).length

  const books = booksBalanceCheck(ledger)
  const volunteersTotal = ledger.users
    .filter((u) => u.role === 'volunteer')
    .reduce((sum, u) => sum + volunteerCashInHand(u.id, ledger), 0)

  return (
    <>
      <NetBalanceHero
        books={books}
        collected={totalCollected(ledger)}
        spent={totalExpenses(ledger)}
        net={netBalance(ledger)}
        donationCount={donationCount}
        paymentCount={paymentCount}
        opening={ledger.bankOpeningPaise}
        volunteers={volunteersTotal}
        treasurer={cashHeldByTreasurer(ledger)}
        bank={bankBalance(ledger)}
      />

      <CashWithVolunteersCard ledger={ledger} volunteers={volunteers} volunteersTotal={volunteersTotal} />

      <DayCard donations={donations} names={names} />

      <div className={panel}>
        <h2 className={panelTitle}>{t.whereMoneyWentTitle}</h2>
        <div className="mt-4">
          {(() => {
            const segments = toExpenseSegments(expenses)
            return segments.length === 0 ? (
              <p className="py-6 text-center text-sm text-stone-400">{t.noExpensesYet}</p>
            ) : (
              <FundDonut segments={segments} />
            )
          })()}
        </div>
      </div>

      <SourceCard donations={donations} sources={sources} />
      <InsightCard donations={donations} />
    </>
  )
}

// The dark hero: net balance, the balanced/off-by verdict as a chip, and one bar
// showing how much of what came in has gone out again. The full arithmetic lives
// behind the "i" (ReconSheet) rather than being printed as an equation — the
// treasurer's question is "does it balance", not "what are the six terms".
function NetBalanceHero({
  books,
  collected,
  spent,
  net,
  donationCount,
  paymentCount,
  opening,
  volunteers,
  treasurer,
  bank,
}: {
  books: BooksBalanceResult
  collected: number
  spent: number
  net: number
  donationCount: number
  paymentCount: number
  opening: number
  volunteers: number
  treasurer: number
  bank: number
}) {
  const [reconOpen, setReconOpen] = useState(false)
  const spentPct = formatPct(spent, collected)

  return (
    <div className={hero}>
      <div className="flex items-center gap-2">
        <span className={eyebrowOnDark}>{t.netBalanceEyebrow}</span>
        {books.balanced ? (
          <span className="flex items-center gap-1 rounded-full border border-green-400/30 bg-green-600/15 py-[3px] pr-2 pl-1.5 text-[10px] font-bold text-green-300">
            <span
              aria-hidden="true"
              className="flex h-3 w-3 items-center justify-center rounded-full bg-green-600 text-[8px] text-white"
            >
              ✓
            </span>
            {t.balancedChip}
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full border border-red-400/35 bg-red-600/20 py-[3px] pr-2 pl-1.5 text-[10px] font-bold text-red-300">
            <span
              aria-hidden="true"
              className="flex h-3 w-3 items-center justify-center rounded-full bg-red-600 text-[8px] text-white"
            >
              !
            </span>
            {t.offByPrefix}
            {formatINR(books.discrepancyPaise)}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setReconOpen(true)}
          aria-label={t.reconSheetTitle}
          className={`${infoRoundOnDark} -mt-1 -mr-1`}
        >
          i
        </button>
      </div>

      <p className={`${moneyHero} mt-1.5 mb-0.5 text-[41px] leading-[1.06] tracking-[-0.03em]`}>
        <Money paise={net} decClassName="text-[22px] text-stone-400" />
      </p>
      <p className="text-xs font-medium text-stone-400">{t.netBalanceHint}</p>

      <Bar pct={spentPct} color="var(--color-orange-600)" height={6} className="mt-3.5 mb-2 bg-white/13" />
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[9.5px] font-bold tracking-[0.12em] text-stone-500 uppercase">{t.collectedEyebrow}</p>
          <p className="mt-px text-[15px] font-bold tabular-nums">
            <Money paise={collected} />
          </p>
          <p className="text-[11px] font-medium text-stone-500">{t.donationsUnit(donationCount)}</p>
        </div>
        <div aria-hidden="true" className="w-px self-stretch bg-white/12" />
        <div className="min-w-0 flex-1">
          <p className="text-[9.5px] font-bold tracking-[0.12em] text-stone-500 uppercase">
            {t.spentEyebrowPct(spentPct)}
          </p>
          <p className="mt-px text-[15px] font-bold tabular-nums text-orange-400">
            <Money paise={spent} decClassName="opacity-60" />
          </p>
          <p className="text-[11px] font-medium text-stone-500">{t.paymentsUnit(paymentCount)}</p>
        </div>
      </div>

      <ReconSheet
        open={reconOpen}
        onClose={() => setReconOpen(false)}
        books={books}
        collected={collected}
        spent={spent}
        net={net}
        opening={opening}
        volunteers={volunteers}
        treasurer={treasurer}
        bank={bank}
      />
    </div>
  )
}

// The "i" sheet: the books-balance identity in words rather than as an equation.
// booksBalanceCheck enforces
//   Volunteers + Treasurer cash + Bank = Net Balance + Bank opening,
// so "what we hold" lists the three buckets and "what the books say" the net
// (plus the opening, when there is one) — the two totals printed here always
// agree exactly when the ✓ chip says they do.
function ReconSheet({
  open,
  onClose,
  books,
  collected,
  spent,
  net,
  opening,
  volunteers,
  treasurer,
  bank,
}: {
  open: boolean
  onClose: () => void
  books: BooksBalanceResult
  collected: number
  spent: number
  net: number
  opening: number
  volunteers: number
  treasurer: number
  bank: number
}) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="recon-sheet-title">
      <SheetHeader
        title={t.reconSheetTitle}
        titleId="recon-sheet-title"
        hint={t.reconSheetHint}
        onClose={onClose}
        closeLabel={strings.app.close}
      />

      <p className={`${eyebrow} mt-[18px] mb-1.5`}>{t.reconHoldTitle}</p>
      <div className="flex flex-col">
        <HoldRow label={t.cashWithVolunteersTitle} paise={volunteers} />
        <HoldRow
          label={t.reconTreasurerLabel}
          paise={treasurer}
          hint={treasurer < 0 ? t.reconTreasurerNegativeHint : undefined}
        />
        <HoldRow label={t.equationBank} paise={bank} last />
        <div className="flex items-baseline gap-2.5 border-t-[1.5px] border-stone-900 py-2.5">
          <span className="flex-1 text-[13.5px] font-bold">{t.reconTotalHeld}</span>
          <Money
            paise={volunteers + treasurer + bank}
            className="font-display text-base font-extrabold tabular-nums"
            decClassName="text-xs text-stone-400"
          />
        </div>
      </div>

      <p className={`${eyebrow} mt-3.5 mb-1.5`}>{t.reconBooksTitle}</p>
      <div className="flex items-baseline gap-2.5 py-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold text-stone-700">{t.equationNetLabel}</span>
          <span className="block text-[11px] font-medium tabular-nums text-stone-400">
            {t.reconCollectedMinusSpent(formatINR(collected), formatINR(spent))}
          </span>
        </span>
        <Money
          paise={net + opening}
          className="font-display text-base font-extrabold tabular-nums"
          decClassName="text-xs text-stone-400"
        />
      </div>
      {opening !== 0 && (
        <p className="text-[11px] font-medium text-stone-400">
          {t.equationOpeningLabel} {formatINR(opening)}
        </p>
      )}

      {books.balanced ? (
        <div className="mt-3.5 flex items-center gap-2.5 rounded-[14px] border border-green-200 bg-green-50 px-[13px] py-3">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-green-600 text-[13px] font-bold text-white"
          >
            ✓
          </span>
          <span className="text-[13px] font-bold text-green-800">{t.reconOkLine}</span>
        </div>
      ) : (
        <div className="mt-3.5 flex items-start gap-2.5 rounded-[14px] border border-red-200 bg-red-50 px-[13px] py-3">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-red-600 text-[13px] font-bold text-white"
          >
            !
          </span>
          <span className="text-[12.5px] font-semibold text-red-800">
            <span className="font-extrabold">
              {t.reconOffByPrefix}
              {formatINR(books.discrepancyPaise)}.
            </span>{' '}
            {t.reconBadLine}
          </span>
        </div>
      )}

      <p className="mt-3 text-[11px] font-medium text-stone-400 text-pretty">{t.reconVoidNote}</p>
    </Sheet>
  )
}

function HoldRow({
  label,
  paise,
  hint,
  last = false,
}: {
  label: string
  paise: number
  hint?: string
  last?: boolean
}) {
  return (
    <div className={`flex items-baseline gap-2.5 py-2 ${last ? '' : 'border-b border-stone-100'}`}>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-stone-700">{label}</span>
        {hint && <span className="block text-[11px] font-medium text-stone-400">{hint}</span>}
      </span>
      <Money
        paise={paise}
        className={`text-sm font-bold tabular-nums ${paise < 0 ? 'text-orange-700' : ''}`}
        decClassName={paise < 0 ? 'opacity-60' : 'text-stone-400'}
      />
    </div>
  )
}

// Per-volunteer cash-in-hand. Names come from fetchActiveVolunteers (the Ledger
// only carries ids); every rupee figure comes from the ledger. The header total
// is `volunteersTotal` — the SAME figure booksBalanceCheck's "Volunteers" term
// uses (Σ volunteerCashInHand over every volunteer-role user, signed) — so the
// two never disagree. A deactivated volunteer who still holds collected cash is
// absent from `volunteers` (active-only) but present in that sum, so any
// remainder they hold is surfaced as an "Inactive volunteers" row rather than
// silently vanishing.
//
// Design: whoever still owes is listed openly; everyone settled collapses behind
// one line, because a settled volunteer is not a task.
function CashWithVolunteersCard({
  ledger,
  volunteers,
  volunteersTotal,
}: {
  ledger: Ledger
  volunteers: VolunteerSummary[]
  volunteersTotal: number
}) {
  const [settledOpen, setSettledOpen] = useState(false)

  const rows = volunteers.map((v) => {
    const inHand = volunteerCashInHand(v.id, ledger)
    const collected = ledger.donations
      .filter((d) => d.mode === 'cash' && d.collectedBy === v.id && !d.voided)
      .reduce((sum, d) => sum + d.amountPaise, 0)
    const handed = ledger.handovers
      .filter((h) => h.volunteerId === v.id && !h.voided)
      .reduce((sum, h) => sum + h.amountPaise, 0)
    return { id: v.id, name: v.name, inHand, collected, handed }
  })
  // Whatever the active rows don't account for is held by volunteers no longer
  // in the active list — show it so no cash is invisible.
  const inactiveRemainder = volunteersTotal - rows.reduce((sum, r) => sum + r.inHand, 0)

  const owing = rows.filter((r) => r.inHand > 0)
  // Negative cash-in-hand means the mandal owes THEM (they paid for something
  // out of pocket), which is not "settled" — it belongs with the open rows.
  const outOfPocket = rows.filter((r) => r.inHand < 0)
  const settled = rows.filter((r) => r.inHand === 0)

  return (
    <div className={panel}>
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <h2 className={panelTitle}>{t.cashWithVolunteersTitle}</h2>
          <p className="mt-0.5 text-[11.5px] font-medium text-stone-400">
            {t.volunteersOwing(owing.length, rows.length)}
          </p>
        </div>
        <Money
          paise={volunteersTotal}
          className="font-display flex-none text-[17px] font-extrabold tabular-nums text-maroon"
          decClassName="text-xs opacity-55"
        />
      </div>

      {[...owing, ...outOfPocket].map((r) => (
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
            <Money
              paise={r.inHand < 0 ? -r.inHand : r.inHand}
              className={`text-[14.5px] font-bold tabular-nums ${r.inHand < 0 ? 'text-maroon' : ''}`}
            />
            <p
              className={`text-[10px] font-bold tracking-[0.02em] ${r.inHand < 0 ? 'text-maroon' : 'text-orange-600'}`}
            >
              {r.inHand < 0 ? strings.cashInHand.mandalOwesTag : strings.cashInHand.stillOwesTag}
            </p>
          </div>
        </div>
      ))}

      {inactiveRemainder !== 0 && (
        <div className="mt-3 flex items-center gap-[11px] border-t border-stone-100 pt-3">
          <LetterAvatar name="…" muted />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-500">{t.inactiveVolunteersLabel}</p>
          <Money paise={inactiveRemainder} className="flex-none text-[14.5px] font-bold tabular-nums" />
        </div>
      )}

      {settledOpen &&
        settled.map((r) => (
          <div key={r.id} className="animate-fade-up mt-2.5 flex items-center gap-[11px] border-t border-stone-100 pt-2.5">
            <LetterAvatar name={r.name} muted size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-stone-600">{r.name}</p>
              <p className="text-[11px] font-medium tabular-nums text-stone-400">
                {t.collectedPrefix}
                {formatINR(r.collected)} · {t.handedPrefix}
                {formatINR(r.handed)}
              </p>
            </div>
            <Money paise={r.inHand} className="flex-none text-[13px] font-semibold tabular-nums text-stone-400" />
          </div>
        ))}

      {settled.length > 0 && (
        <button
          type="button"
          aria-expanded={settledOpen}
          onClick={() => setSettledOpen((s) => !s)}
          className="mt-[11px] h-[34px] w-full rounded-[10px] border border-hairline bg-stone-50 text-[11.5px] font-bold text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
        >
          {settledOpen ? t.settledHide : t.settledShow(settled.length)}
        </button>
      )}

      {rows.length === 0 && inactiveRemainder === 0 && (
        <p className="py-6 text-center text-sm text-stone-400">{strings.cashInHand.empty}</p>
      )}
    </div>
  )
}

const WEEKDAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const WEEKDAY_LONG = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "Today · 18 Aug" / "Yesterday · 17 Aug" / "Sun, 16 Aug 2026" — the design's
// day label. Relative for the two days a treasurer actually thinks in, absolute
// (with the year) beyond that so an old day is never ambiguous.
function dayLabel(day: Date, today: Date): string {
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const stamp = `${day.getDate()} ${MONTH_SHORT[day.getMonth()]}`
  if (day.toDateString() === today.toDateString()) return `${t.dayTodayPrefix}${stamp}`
  if (day.toDateString() === yesterday.toDateString()) return `${t.dayYesterdayPrefix}${stamp}`
  return `${WEEKDAY_LONG[day.getDay()]}, ${stamp} ${day.getFullYear()}`
}

// Plan 2026-08-16 §2b, redrawn 2026-08-18. Volunteers come back in the evening
// and the treasurer checks the day's take: pick a day off the tile row (newest
// first, a dot where money landed) or any day at all from the picker sheet, then
// read the total, the mode split, the source split and who collected how much.
// All client-side over the uncapped lite rows via summarizeDay, so switching day
// is instant and never re-queries.
function DayCard({ donations, names }: { donations: DonationLite[]; names: Record<string, string> }) {
  const today = new Date()
  const todayKey = formatLocalDay(today)
  const [dayKey, setDayKey] = useState(todayKey)
  const [pickerOpen, setPickerOpen] = useState(false)

  const marked = daysWithCollections(donations)
  const selected = parseLocalDay(dayKey) ?? today
  const summary = summarizeDay(donations, selected)

  // The tile row walks the SELECTED day's month, newest first, and stops at
  // today in the current month — a tile for a day that hasn't happened is a
  // tile that can only disappoint.
  const inCurrentMonth =
    selected.getFullYear() === today.getFullYear() && selected.getMonth() === today.getMonth()
  const lastDay = inCurrentMonth ? today.getDate() : new Date(selected.getFullYear(), selected.getMonth() + 1, 0).getDate()
  const tiles = Array.from({ length: lastDay }, (_, i) => lastDay - i).map((n) => {
    const date = new Date(selected.getFullYear(), selected.getMonth(), n)
    return { n, key: formatLocalDay(date), weekday: WEEKDAY_SHORT[date.getDay()] }
  })

  return (
    <div className={panel}>
      <div className="flex items-baseline justify-between gap-2.5">
        <h2 className={panelTitle}>{t.dayCardTitle}</h2>
        <span className="text-[11.5px] font-semibold text-stone-400">{dayLabel(selected, today)}</span>
      </div>

      <div className="mt-3 flex items-stretch gap-2">
        <div className="-ml-[15px] flex min-w-0 flex-1 gap-[7px] overflow-x-auto pt-0.5 pr-0.5 pb-1 pl-[15px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tiles.map((tile) => {
            const on = tile.key === dayKey
            return (
              <button
                key={tile.key}
                type="button"
                aria-pressed={on}
                aria-label={tile.key}
                onClick={() => setDayKey(tile.key)}
                className={`flex w-[47px] flex-none flex-col items-center gap-px rounded-[14px] border py-[7px] transition-colors ${
                  on
                    ? 'border-stone-900 bg-stone-900 text-white shadow-[0_6px_14px_-8px_rgba(28,25,23,.6)]'
                    : 'border-stone-200 bg-white text-stone-600'
                }`}
              >
                <span className="text-[9px] font-bold tracking-[0.09em] uppercase opacity-55">{tile.weekday}</span>
                <span className="font-display text-[15.5px] leading-[1.15] font-extrabold tracking-[-0.01em]">
                  {tile.n}
                </span>
                <span
                  aria-hidden="true"
                  className={`mt-[3px] h-1 w-1 rounded-full ${
                    marked.has(tile.key) ? (on ? 'bg-orange-400' : 'bg-orange-600') : 'bg-transparent'
                  }`}
                />
              </button>
            )
          })}
        </div>
        {!inCurrentMonth && (
          <button
            type="button"
            onClick={() => setDayKey(todayKey)}
            className="h-[30px] flex-none self-center rounded-full border border-hairline bg-stone-100 px-[11px] text-[11.5px] font-bold text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900"
          >
            {t.dayToday}
          </button>
        )}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-label={t.dayPickLabel}
          className="flex w-[47px] flex-none flex-col items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-stone-300 bg-stone-50 py-[7px] text-stone-500 transition-colors hover:border-stone-900 hover:text-stone-900"
        >
          <span aria-hidden="true" className="relative block h-[14px] w-[15px] rounded-[3px] border-[1.5px] border-current">
            <span className="absolute top-0.5 right-px left-px h-[1.5px] bg-current" />
          </span>
          <span className="text-[8.5px] font-bold tracking-[0.09em] uppercase">{t.pickShort}</span>
        </button>
      </div>

      {summary.count === 0 ? (
        <div className="animate-fade-up mt-3.5 rounded-[14px] border border-dashed border-stone-200 bg-stone-50 px-3.5 py-5 text-center">
          <p className="font-display text-2xl font-extrabold tracking-[-0.02em] text-stone-300">{formatINR(0)}</p>
          <p className="mt-1 text-[12.5px] font-semibold text-stone-500">
            {dayKey === todayKey ? t.dayEmptyToday : t.dayEmptyOther}
          </p>
          <p className="mt-0.5 text-[11.5px] font-medium text-stone-400">{t.dayEmptyHint}</p>
        </div>
      ) : (
        <DayBreakdown summary={summary} names={names} />
      )}

      <DayPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selected={dayKey}
        markedDays={marked}
        today={todayKey}
        onPick={(day) => {
          setDayKey(day)
          setPickerOpen(false)
        }}
      />
    </div>
  )
}

const DAY_MODES = [
  { value: 'cash', label: strings.collection.modeCash },
  { value: 'upi', label: strings.collection.modeUpi },
  { value: 'bank', label: strings.collection.modeBank },
]

function DayBreakdown({ summary, names }: { summary: DaySummary; names: Record<string, string> }) {
  const bySource = Object.entries(summary.bySource).sort((a, b) => b[1] - a[1])
  const byVolunteer = Object.entries(summary.byVolunteer).sort((a, b) => b[1] - a[1])
  const top = byVolunteer.length > 0 ? byVolunteer[0][1] : 0

  return (
    <div className="animate-fade-up mt-3.5">
      <div className="flex items-end justify-between gap-2.5">
        <p className="font-display text-[30px] leading-none font-extrabold tracking-[-0.025em] tabular-nums text-emerald-700">
          <Money paise={summary.totalPaise} decClassName="text-[17px] opacity-50" />
        </p>
        <p className="pb-0.5 text-[11.5px] font-semibold text-stone-400">{t.donationsCollected(summary.count)}</p>
      </div>

      <p className={`${eyebrow} mt-4 mb-2`}>{t.byModeTitle}</p>
      <div className="flex flex-col gap-2.5">
        {DAY_MODES.map((m) => {
          const paise = summary.byMode[m.value] ?? 0
          return (
            <div key={m.value} className="flex items-center gap-2.5">
              <span className="w-[38px] flex-none text-[12.5px] font-semibold text-stone-600">{m.label}</span>
              <Bar
                pct={formatPct(paise, summary.totalPaise)}
                color="var(--color-stone-300)"
                height={5}
                className="flex-1"
              />
              <Money
                paise={paise}
                className="min-w-[74px] flex-none text-right text-[12.5px] font-bold tabular-nums text-stone-800"
              />
            </div>
          )
        })}
      </div>

      <p className={`${eyebrow} mt-4 mb-2`}>{t.bySourceTitle}</p>
      <div className="flex flex-col gap-2.5">
        {bySource.map(([name, paise], i) => (
          <div key={name} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 flex-none rounded-full"
              style={{ backgroundColor: slotColor(i) }}
            />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-stone-700">{name}</span>
            <span className="flex-none text-[11px] font-semibold text-stone-400">
              {strings.collections.donationsUnit(summary.bySourceCount[name] ?? 0)}
            </span>
            <Money paise={paise} className="min-w-[74px] flex-none text-right text-[12.5px] font-bold tabular-nums" />
          </div>
        ))}
      </div>

      <p className={`${eyebrow} mt-4 mb-2`}>{t.byVolunteerTitle}</p>
      <div className="flex flex-col gap-2.5">
        {byVolunteer.map(([id, paise]) => (
          <div key={id}>
            <div className="flex items-baseline gap-2.5">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                {names[id] ?? strings.collections.unknownCollector}
              </span>
              <Money paise={paise} className="flex-none text-[13.5px] font-bold tabular-nums" />
            </div>
            <Bar pct={formatPct(paise, top)} color="var(--color-orange-600)" height={4} className="mt-1.5 opacity-75" />
          </div>
        ))}
      </div>
    </div>
  )
}

// Where the money CAME from. The mandal's current source list leads, then any
// source a donation was actually recorded under — a renamed or removed source
// still holds rupees, and they must not fall off the card.
function SourceCard({ donations, sources }: { donations: DonationLite[]; sources: string[] }) {
  const live = donations.filter((d) => !d.voided)
  const options = sourceFilterOptions(
    sources,
    live.map((d) => d.category),
  )
  const acc = new Map<string, { paise: number; count: number }>(options.map((o) => [o, { paise: 0, count: 0 }]))
  for (const d of live) {
    const bucket = acc.get(sourceLabel(d.category))
    if (!bucket) continue
    bucket.paise += d.amount_paise
    bucket.count += 1
  }
  const total = live.reduce((sum, d) => sum + d.amount_paise, 0)
  // Rank by amount so the card leads with where the money actually comes from,
  // but keep every option present (a zero row is information: nobody gave there).
  const rows = [...acc.entries()].sort((a, b) => b[1].paise - a[1].paise)

  return (
    <div className={panel}>
      <h2 className={panelTitle}>{t.whereMoneyCameFromTitle}</h2>
      {live.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-400">{t.noDonationsYet}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {rows.map(([name, bucket], i) => (
            <div key={name}>
              <div className="flex items-baseline gap-2">
                <span
                  className={`min-w-0 flex-1 truncate text-[13.5px] font-semibold ${
                    bucket.paise === 0 ? 'text-stone-500' : ''
                  }`}
                >
                  {name}
                </span>
                <span className="flex-none text-[11.5px] font-semibold text-stone-400">
                  {strings.collections.donationsUnit(bucket.count)}
                </span>
                <Money
                  paise={bucket.paise}
                  className={`min-w-[82px] flex-none text-right text-[13.5px] font-bold tabular-nums ${
                    bucket.paise === 0 ? 'text-stone-400' : ''
                  }`}
                />
              </div>
              <Bar
                pct={formatPct(bucket.paise, total)}
                color={slotColor(i)}
                height={5}
                className="mt-1.5"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Total count, unique donors (distinct phone-or-lowercased name, phones
// normalized so a 10-digit legacy row and its +91 twin count once), average and
// largest — all over non-voided donations.
function InsightCard({ donations }: { donations: DonationLite[] }) {
  const active = donations.filter((d) => !d.voided)
  const total = active.reduce((sum, d) => sum + d.amount_paise, 0)
  const uniqueDonors = new Set(
    active.map((d) => (d.donor_phone ? normalizeToE164(d.donor_phone) : d.donor_name.trim().toLowerCase())),
  ).size
  const average = active.length ? Math.round(total / active.length) : 0
  const largest = active.reduce((max, d) => Math.max(max, d.amount_paise), 0)

  const stats = [
    { label: t.insightTotalDonations, value: String(active.length) },
    { label: t.insightUniqueDonors, value: String(uniqueDonors) },
    { label: t.insightAvgDonation, value: formatINR(average) },
    { label: t.insightLargestDonation, value: formatINR(largest) },
  ]

  return (
    <div className={panel}>
      <h2 className={panelTitle}>{t.insightTitle}</h2>
      {active.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-400">{t.noDonationsYet}</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-2.5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-hairline bg-stone-50 px-[11px] py-2.5">
              <dt className="text-[9.5px] font-bold tracking-[0.12em] text-stone-400 uppercase">{s.label}</dt>
              <dd className="font-display mt-0.5 text-xl font-extrabold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function DashboardSkeleton(): ReactNode {
  return (
    <>
      <div className={`${panel} h-40 animate-pulse`} />
      <div className={`${panel} h-32 animate-pulse`} />
      <div className={`${panel} h-56 animate-pulse`} />
    </>
  )
}
