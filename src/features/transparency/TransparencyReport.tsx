import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { TransparencyTotals, CategoryBreakdown } from '../../lib/db/transparency'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'

const t = strings.transparency

// Fixed categorical order from the dataviz skill's validated reference
// palette (references/palette.md) — colorblind-safe as an ordered set, so
// slots are assigned by rank, never generated/cycled. A 9th+ category
// folds into "Other" (muted gray) rather than growing the palette.
// ponytail: no dark-mode chart theming / palette-validator run / table-view
// fallback — this app has no dark mode anywhere else and ≤8 categories is
// the realistic ceiling for a single mandal's expense categories; add if
// either changes.
const CATEGORY_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834']
const OTHER_COLOR = '#898781'

function toChartData(categories: CategoryBreakdown[]): { name: string; value: number }[] {
  const sorted = [...categories].sort((a, b) => b.amountPaise - a.amountPaise)
  const head = sorted.slice(0, CATEGORY_COLORS.length)
  const rest = sorted.slice(CATEGORY_COLORS.length)
  const data = head.map((c) => ({ name: c.category, value: c.amountPaise }))
  const otherTotal = rest.reduce((sum, c) => sum + c.amountPaise, 0)
  if (otherTotal > 0) data.push({ name: t.otherCategory, value: otherTotal })
  return data
}

// Presentational only — no data fetching. Reused by both the public report
// (PublicTransparency.tsx) and the admin preview (AdminTransparency.tsx) so
// the two can never render the aggregate differently. `categories` only
// ever contains category+amount sums (get_transparency_categories, Task 16
// migration) — no donor or individual-expense row ever reaches this
// component to begin with.
export function TransparencyReport({
  totals,
  categories,
}: {
  totals: TransparencyTotals
  categories: CategoryBreakdown[]
}) {
  const data = toChartData(categories)

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded border border-stone-200 p-4 text-center">
        <p className="text-sm text-stone-500">{t.totalCollectedLabel}</p>
        <p className="text-3xl font-semibold text-stone-900">{formatINR(totals.totalCollectedPaise)}</p>
      </div>

      {data.length === 0 ? (
        <p className="text-stone-400">{t.noExpenses}</p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" label={(entry) => String(entry.name ?? '')}>
              {data.map((entry, index) => (
                <Cell
                  key={entry.name}
                  fill={index < CATEGORY_COLORS.length ? CATEGORY_COLORS[index] : OTHER_COLOR}
                />
              ))}
            </Pie>
            <Tooltip formatter={(value) => formatINR(Number(value))} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
