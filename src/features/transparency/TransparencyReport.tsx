import type { TransparencyTotals, CategoryBreakdown } from '../../lib/db/transparency'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { FundDonut, type DonutSegment } from '../../components/FundDonut'

const t = strings.transparency

// Warm festival palette for the "how funds were used" donut — reads on the
// cream paper and stays distinguishable as an ordered set. Slots are assigned
// by rank (largest category first), never cycled; a 9th+ category folds into
// "Other" (muted warm gray) rather than growing the palette.
// ponytail: no colourblind-validator run — the donut is decorative and every
// slice is also a text+amount legend row (FundDonut), so colour is never the
// only channel; ≤8 expense categories is the realistic ceiling for one mandal.
const CATEGORY_COLORS = ['#e2680f', '#2f7d44', '#dca02c', '#c0442e', '#7c4a86', '#2f8a86', '#c96b93', '#8a6d3b']
const OTHER_COLOR = '#a8998a'

function toSegments(categories: CategoryBreakdown[]): DonutSegment[] {
  const sorted = [...categories].sort((a, b) => b.amountPaise - a.amountPaise)
  const head = sorted.slice(0, CATEGORY_COLORS.length)
  const rest = sorted.slice(CATEGORY_COLORS.length)
  const segments: DonutSegment[] = head.map((c, i) => ({
    name: c.category,
    value: c.amountPaise,
    color: CATEGORY_COLORS[i],
  }))
  const otherTotal = rest.reduce((sum, c) => sum + c.amountPaise, 0)
  if (otherTotal > 0) segments.push({ name: t.otherCategory, value: otherTotal, color: OTHER_COLOR })
  return segments
}

// Presentational only — no data fetching. Reused by both the public report
// (PublicTransparency.tsx) and the admin preview (AdminTransparency.tsx) so
// the two can never render the aggregate differently. `categories` only ever
// contains category+amount sums (get_transparency_categories) — no donor or
// individual-expense row ever reaches this component. `mandalName` is a
// display title only; the public page derives it from the slug (mandals is
// admin-only at the RLS level, so its real name can't be read unauthenticated
// without a new RPC).
export function TransparencyReport({
  totals,
  categories,
  mandalName,
}: {
  totals: TransparencyTotals
  categories: CategoryBreakdown[]
  mandalName?: string
}) {
  const segments = toSegments(categories)
  const inHandPaise = totals.totalCollectedPaise - totals.totalExpensesPaise
  const familyLine =
    totals.donorCount === 1
      ? `${t.familyPrefix}${totals.donorCount}${t.familySuffix}`
      : `${t.acrossFamiliesPrefix}${totals.donorCount}${t.acrossFamiliesSuffix}`

  return (
    <div className="overflow-hidden rounded-3xl border border-amber-200/70 bg-[#f7f0e1] shadow-xl shadow-amber-900/5">
      <div className="flex flex-col gap-8 px-5 py-8 sm:px-8 sm:py-10">
        {/* Header — mantra + identity */}
        <header className="text-center">
          <p className="text-sm tracking-[0.25em] text-amber-700">॥ श्री गणेशाय नमः ॥</p>
          {mandalName && (
            <h2 className="font-serif mt-2.5 text-3xl leading-tight font-semibold text-stone-800 sm:text-4xl">
              {mandalName}
            </h2>
          )}
          <p className="mt-2 text-[11px] font-semibold tracking-[0.22em] text-stone-400 uppercase">
            {t.reportEyebrow}
          </p>
        </header>

        {/* Hero — total collected */}
        <div className="rounded-2xl border border-amber-200/70 bg-[#fbf6ea] px-5 py-7 text-center">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-stone-500 uppercase">
            {t.totalCollectedLabel}
          </p>
          <p className="font-serif mt-2 text-5xl font-semibold text-emerald-700 sm:text-6xl">
            {formatINR(totals.totalCollectedPaise)}
          </p>
          <p className="mt-3 text-sm text-stone-500 italic">{familyLine}</p>
        </div>

        {/* How the funds were used */}
        <section>
          <h3 className="font-serif mb-6 text-center text-xl font-semibold text-stone-800">{t.usageTitle}</h3>
          {segments.length === 0 ? (
            <p className="text-center text-stone-400">{t.noExpenses}</p>
          ) : (
            <>
              <FundDonut segments={segments} />
              {/* Spent vs. still-in-hand — both derive from data already on
                  screen; the honest close to a fund report. */}
              <div className="mt-8 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-amber-200/60 bg-[#fbf6ea] px-4 py-3 text-center">
                  <p className="text-[10px] font-semibold tracking-wider text-stone-400 uppercase">{t.spentLabel}</p>
                  <p className="font-serif mt-1 text-lg font-semibold text-stone-800">
                    {formatINR(totals.totalExpensesPaise)}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-200/60 bg-[#fbf6ea] px-4 py-3 text-center">
                  <p className="text-[10px] font-semibold tracking-wider text-stone-400 uppercase">{t.inHandLabel}</p>
                  <p className="font-serif mt-1 text-lg font-semibold text-stone-800">{formatINR(inHandPaise)}</p>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Privacy note — verbatim, in a dashed-border box (design reference). */}
        <div className="rounded-2xl border border-dashed border-amber-300/80 bg-[#fbf6ea]/60 px-5 py-4">
          <p className="text-center text-xs leading-relaxed text-stone-500">{t.privacyNote}</p>
        </div>

        <p className="text-center text-xs text-stone-400">{t.footerNote}</p>
      </div>
    </div>
  )
}
