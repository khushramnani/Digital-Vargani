import type { ReactNode } from 'react'
import { splitINR } from '../lib/money'
import { closeRound } from './ui'

// The handful of shapes the 2026-08-18 console repeats often enough that a
// component beats a copied span: the two-part money figure, a sheet header, the
// search box, the switch, a letter avatar, and a proportion bar. Everything else
// stays inline Tailwind with the class strings in ui.ts.

// ₹54,003 with a dimmed .00 tail — the design's figure treatment everywhere.
// The split comes from lib/money.ts so it is the same arithmetic as formatINR.
export function Money({
  paise,
  className = '',
  decClassName = 'text-stone-400',
}: {
  paise: number
  className?: string
  decClassName?: string
}) {
  const { main, dec } = splitINR(paise)
  return (
    <span className={className}>
      {main}
      <span className={decClassName}>{dec}</span>
    </span>
  )
}

// Title (+ optional hint) on the left, close button on the right. `titleId` is
// what the caller passes to <Sheet labelledBy> so the dialog is named.
export function SheetHeader({
  title,
  titleId,
  hint,
  onClose,
  closeLabel,
  children,
}: {
  title: string
  titleId: string
  hint?: string
  onClose: () => void
  closeLabel: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      {children}
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="font-display text-[19px] font-extrabold tracking-[-0.02em] text-stone-900">
          {title}
        </h2>
        {hint && <p className="mt-0.5 text-[11.5px] leading-relaxed text-stone-400 text-pretty">{hint}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label={closeLabel} className={closeRound}>
        ✕
      </button>
    </div>
  )
}

// The drawn magnifier from the design — a bordered circle plus a rotated bar, so
// there is no icon font and no emoji.
function SearchGlyph() {
  return (
    <span
      aria-hidden="true"
      className="relative block h-[13px] w-[13px] flex-none rounded-full border-[1.6px] border-stone-400"
    >
      <span className="absolute -right-[4px] -bottom-[3px] h-[1.6px] w-[5px] rotate-45 bg-stone-400" />
    </span>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  id?: string
}) {
  return (
    <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-stone-200 bg-white px-3">
      <SearchGlyph />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13.5px] font-medium text-stone-900 outline-none placeholder:text-stone-400"
      />
    </div>
  )
}

// The design's pill switch. Purely presentational — the caller owns the button
// and its aria-pressed, so the whole row stays one tap target.
export function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-[42px] flex-none items-center rounded-full p-[3px] transition-colors ${
        on ? 'justify-end bg-stone-900' : 'justify-start bg-stone-200'
      }`}
    >
      <span className="block h-[18px] w-[18px] rounded-full bg-white" />
    </span>
  )
}

// Initial-in-a-circle stands in for a photo everywhere in the design. Amber for
// someone who is "live" in this context (owes cash, active member), stone once
// they are settled or deactivated.
export function LetterAvatar({
  name,
  muted = false,
  size = 36,
}: {
  name: string
  muted?: boolean
  size?: number
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`flex flex-none items-center justify-center rounded-full text-sm font-bold ${
        muted ? 'bg-stone-100 text-stone-400' : 'bg-amber-100 text-amber-800'
      }`}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

// A proportion bar. `pct` is a already-formatted percentage string ("63.5%") so
// the caller keeps control of rounding; a zero-width fill renders as the empty
// track, which is what the design shows for a category with nothing in it.
export function Bar({
  pct,
  color = 'var(--color-slot-1)',
  height = 5,
  className = '',
}: {
  pct: string
  color?: string
  height?: number
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      style={{ height }}
      className={`flex overflow-hidden rounded-full bg-stone-100 ${className}`}
    >
      <span style={{ width: pct, backgroundColor: color }} />
    </div>
  )
}
