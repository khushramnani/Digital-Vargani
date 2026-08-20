// Shared control styling so every authenticated screen speaks the same visual
// language as the auth/landing surfaces (rounded-xl fields, orange-600
// actions, soft focus ring) instead of the bare `rounded border` stubs each
// Task-era screen grew on its own. Class strings, not components, to match the
// codebase's existing inline-Tailwind convention (see AuthShell/Collections).
export const card = 'rounded-2xl border border-stone-200 bg-white shadow-sm'
export const label = 'text-sm font-semibold text-stone-600'

export const field =
  'w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-[15px] text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20'
// Volunteer entry forms are tapped one-handed on a phone at the door — keep
// the large targets those screens already had, just modernised.
export const fieldLg = field + ' px-4 py-3.5 text-lg'

export const btnPrimary =
  'rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-colors hover:bg-stone-900 disabled:opacity-50'
export const btnPrimaryLg =
  'rounded-xl bg-orange-600 px-4 py-4 text-base font-bold text-white shadow-lg shadow-orange-600/30 transition-colors hover:bg-stone-900 disabled:opacity-50'
export const btnGhost =
  'rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-bold text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50'

export const errorText = 'text-sm text-red-600'
export const backLink = 'inline-flex w-fit items-center gap-1 text-sm font-semibold text-orange-600 transition-colors hover:text-orange-700'

// ─────────────────────────────────────────────────────────────────────────────
// 2026-08-18 mobile console (docs/design/admin-dashboard-redesign.dc.html).
//
// The design repeats a small vocabulary — dark hero, white card, uppercase
// eyebrow, two pill flavours, chip rows, sheets — across seven tabs and
// eighteen sheets. These are that vocabulary, so a screen states WHAT it is
// showing and this file owns how it looks. Colours are Tailwind tokens; the few
// that have no ramp equivalent are theme tokens from index.css.
// ─────────────────────────────────────────────────────────────────────────────

// The dark gradient card at the top of most tabs. 168deg + the design's exact
// two inks; the shadow lifts it off the stone-50 page.
export const hero =
  'rounded-[20px] bg-linear-[168deg,var(--color-ink-hero-from),var(--color-ink-hero-to)] p-[15px] text-white shadow-[0_16px_30px_-20px_rgba(24,20,16,.7)]'

// Every other panel. 18px radius + a 1px shadow, not the 2xl/shadow-sm of the
// pre-redesign `card` above (kept for the auth/landing screens still using it).
export const panel =
  'rounded-[18px] border border-stone-200 bg-white p-[15px] shadow-[0_1px_2px_rgba(28,25,23,.04)]'

// Uppercase micro-label above a group ("DONOR NAME", "BY PAYMENT MODE").
export const eyebrow = 'text-[9.5px] font-bold tracking-[0.14em] text-stone-400 uppercase'
// The same label on a dark hero, where it needs slightly looser tracking.
export const eyebrowOnDark = 'text-[10px] font-bold tracking-[0.15em] text-stone-400 uppercase'

// A panel's own heading.
export const panelTitle = 'font-display text-[15.5px] font-bold tracking-[-0.01em] text-stone-900'

// Big money. The rupees; `<Money>` dims the paise tail itself.
export const moneyHero = 'font-display text-[33px] leading-[1.08] font-extrabold tracking-[-0.03em] tabular-nums'
export const moneyDisplay = 'font-display text-[25px] font-extrabold tracking-[-0.02em] tabular-nums'

// Section tabs in the console header — orange when active (the design's one
// orange navigation accent).
export function navPill(active: boolean): string {
  return active
    ? 'flex-none rounded-full bg-orange-600 px-[13px] py-1.5 text-[12.5px] font-bold text-white shadow-[0_4px_10px_-4px_rgba(234,88,12,.6)]'
    : 'flex-none rounded-full border border-stone-200 bg-white px-[13px] py-1.5 text-[12.5px] font-semibold text-stone-600 transition-colors hover:border-stone-300 hover:text-stone-900'
}

// Filter / choice chips inside sheets and chip rows — ink when active, so they
// never compete with the orange primary action on the same screen.
export function pill(active: boolean): string {
  return active
    ? 'h-[34px] flex-none rounded-full border border-stone-900 bg-stone-900 px-3.5 text-[12.5px] font-bold text-white'
    : 'h-[34px] flex-none rounded-full border border-stone-200 bg-white px-3.5 text-[12.5px] font-semibold text-stone-600 transition-colors hover:border-stone-400'
}

// "Add a source" / "+ New" — a chip that is clearly a slot, not a value.
export const pillDashed =
  'h-[34px] flex-none rounded-full border border-dashed border-stone-300 bg-stone-50 px-[13px] text-[12.5px] font-bold text-stone-500 transition-colors hover:border-stone-900 hover:text-stone-900'

// Segmented control (Donations | Donors).
export function segButton(active: boolean): string {
  return active
    ? 'h-[34px] flex-1 rounded-[10px] border border-stone-200 bg-white text-[12.5px] font-bold text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,.09)]'
    : 'h-[34px] flex-1 rounded-[10px] text-[12.5px] font-semibold text-stone-500'
}
export const segTrack = 'flex gap-[5px] rounded-[14px] border border-stone-200 bg-hairline p-1'

// A tall two- or three-up choice (Cash | Bank, Volunteer | Admin) — orange fill
// when chosen, because this IS the decision the form is waiting on.
export function choiceButton(active: boolean): string {
  return active
    ? 'h-[52px] flex-1 rounded-[14px] border-[1.5px] border-orange-600 bg-orange-600 text-[15px] font-bold text-white shadow-[0_8px_18px_-10px_rgba(234,88,12,.65)]'
    : 'h-[52px] flex-1 rounded-[14px] border-[1.5px] border-stone-200 bg-white text-[15px] font-semibold text-stone-700 transition-colors hover:border-stone-400'
}

// The collect form's 86px payment-mode tiles: a drawn glyph over a text label,
// tinted rather than filled when chosen so the three read as one row.
export function modeTile(active: boolean): string {
  const base =
    'flex h-[86px] flex-1 flex-col items-center justify-center gap-[9px] rounded-[16px] border-[1.5px] text-[13.5px] font-bold transition-colors'
  return active
    ? `${base} border-orange-600 bg-orange-50 text-orange-700`
    : `${base} border-stone-200 bg-white text-stone-600 hover:border-stone-400`
}

// Primary actions. The orange one is the single "commit this" button per screen;
// the ink one is a secondary commit (Log another, Jump to today); muted is the
// disabled state, which the design shows as a filled grey rather than a faded
// orange (so it never looks tappable).
export const ctaOrange =
  'h-[52px] w-full rounded-[14px] bg-orange-600 text-[15.5px] font-bold text-white shadow-[0_12px_24px_-12px_rgba(234,88,12,.7)] transition-colors hover:bg-orange-500'
export const ctaInk =
  'h-[48px] w-full rounded-[14px] bg-stone-900 text-[14.5px] font-bold text-white shadow-[0_10px_22px_-14px_rgba(28,25,23,.8)] transition-colors hover:bg-stone-800'
export const ctaMuted = 'h-[52px] w-full cursor-default rounded-[14px] bg-stone-100 text-[15.5px] font-bold text-faint'
export const ctaQuiet =
  'h-[46px] w-full rounded-[13px] bg-stone-100 text-[13.5px] font-bold text-stone-600 transition-colors hover:bg-stone-200'
export const ctaDanger =
  'h-[42px] w-full rounded-[12px] border border-red-200 text-[12.5px] font-bold text-red-600 transition-colors hover:bg-red-50'

// Small in-row buttons.
export const btnRow =
  'h-[34px] flex-none rounded-[10px] border border-stone-200 bg-white px-[13px] text-xs font-bold text-stone-700 transition-colors hover:border-stone-900'
export const btnRowGreen =
  'h-[34px] flex-none rounded-[10px] border border-green-200 bg-green-50 px-[13px] text-xs font-bold text-green-800 transition-colors hover:bg-green-100'

// The round ✕ that closes a sheet, and the round i that opens an explainer.
export const closeRound =
  'flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-stone-100 text-[15px] font-semibold text-stone-600 transition-colors hover:bg-stone-200'
export const infoRoundOnDark =
  'flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full border border-white/15 bg-white/10 font-display text-sm font-bold text-stone-200 transition-colors hover:bg-white/20 hover:text-white'
export const infoRound =
  'flex h-[28px] w-[28px] flex-none items-center justify-center rounded-full border border-stone-200 bg-white font-display text-[13px] font-bold text-stone-500 transition-colors hover:border-stone-900 hover:text-stone-900'

// A tappable list row (donation, donor, expense).
export const rowCard =
  'flex w-full gap-[11px] rounded-[16px] border border-stone-200 bg-white p-[12px_13px] text-left shadow-[0_1px_2px_rgba(28,25,23,.04)] transition-colors hover:border-stone-300'
export const rowCardVoid =
  'flex w-full gap-[11px] rounded-[16px] border border-dashed border-stone-200 bg-stone-50 p-[12px_13px] text-left'

// A quiet dashed note (no receipt to send, nothing here yet).
export const dashedNote =
  'rounded-[13px] border border-dashed border-stone-200 bg-stone-50 px-[13px] py-3 text-center text-[11.5px] leading-relaxed text-stone-500 text-pretty'

// Field styles at the design's sizes (the auth screens keep `field` above).
export const consoleField =
  'h-[46px] w-full rounded-[13px] border-[1.5px] border-stone-200 bg-white px-[13px] text-sm font-medium text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-orange-500'
export const consoleFieldTall =
  'h-[50px] w-full rounded-[14px] border-[1.5px] border-stone-200 bg-white px-[14px] text-[15px] font-semibold text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-orange-500'
