import { formatINR } from '../lib/money'

// CSS-only donut (masked conic-gradient) + legend — no chart library, no
// SVG, no per-slice DOM. Segments arrive already coloured and pre-sorted;
// this component only draws them, so the same visual serves both the live
// public report and the static landing preview. The ring is decorative
// (aria-hidden): every slice is also a labelled legend row, so colour is
// never the only channel carrying the number.
export type DonutSegment = { name: string; value: number; color: string }

function conicStops(segments: DonutSegment[], total: number): string {
  let acc = 0
  return segments
    .map((s) => {
      const start = (acc / total) * 100
      acc += s.value
      const end = (acc / total) * 100
      return `${s.color} ${start}% ${end}%`
    })
    .join(', ')
}

export function FundDonut({ segments, size = 176 }: { segments: DonutSegment[]; size?: number }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total <= 0) return null

  return (
    <div className="flex flex-col items-center gap-5">
      <div
        aria-hidden
        className="rounded-full"
        style={{
          width: size,
          height: size,
          background: `conic-gradient(from -90deg, ${conicStops(segments, total)})`,
          // Punch a transparent hole so the paper background shows through —
          // works on any surface without knowing its colour.
          WebkitMask: 'radial-gradient(circle, transparent 55%, #000 56%)',
          mask: 'radial-gradient(circle, transparent 55%, #000 56%)',
        }}
      />
      <ul className="flex w-full flex-col gap-2.5">
        {segments.map((s) => {
          const pct = Math.round((s.value / total) * 100)
          return (
            <li key={s.name} className="flex items-center gap-3 text-sm">
              <span className="h-3 w-3 flex-none rounded-full" style={{ backgroundColor: s.color }} />
              <span className="min-w-0 flex-1 truncate font-medium text-stone-700">{s.name}</span>
              <span className="flex-none tabular-nums text-stone-400">{pct}%</span>
              <span className="font-serif flex-none w-24 text-right font-semibold text-stone-800">
                {formatINR(s.value)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
