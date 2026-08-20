// The rank-ordered chart palette, in ONE place: the expense donut, the
// spend-by-category bars, the source bars and the day breakdown all draw from it,
// so the four read as one system and a slice keeps its colour across screens.
//
// Slots are assigned by RANK (largest first), never cycled by identity; a 9th+
// category folds into SLOT_REST rather than growing the palette.
//
// Written as literal strings on purpose. Tailwind v4 tree-shakes @theme
// variables it cannot see referenced, and these are only ever referenced from
// JS — building them with a template (`var(--color-slot-${n})`) hid every name
// but the first from the scanner, which silently dropped slots 2–8 from the CSS
// and made the donut's conic-gradient invalid: the whole ring vanished, legend
// intact, no error anywhere. The index.css block is `@theme static` as well, so a
// future refactor back to a loop can't reintroduce that.
//
// ponytail: no colourblind-validator run — every chart here is decorative and
// each slice is also a labelled text+amount row, so colour is never the only
// channel carrying a number.
export const SLOT_COLORS = [
  'var(--color-slot-1)',
  'var(--color-slot-2)',
  'var(--color-slot-3)',
  'var(--color-slot-4)',
  'var(--color-slot-5)',
  'var(--color-slot-6)',
  'var(--color-slot-7)',
  'var(--color-slot-8)',
] as const

// Everything past the eighth slot, summed into one muted row.
export const SLOT_REST = 'var(--color-slot-rest)'

// Cash vs bank, the one split that isn't ranked — the expense hero always shows
// these two in this order, so they get fixed colours rather than slots.
export const SLOT_CASH = 'var(--color-slot-1)'
export const SLOT_BANK = 'var(--color-slot-bank)'

// A slot for rank `i`, wrapping rather than running out.
export const slotColor = (i: number): string => SLOT_COLORS[i % SLOT_COLORS.length]
