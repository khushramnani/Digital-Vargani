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
