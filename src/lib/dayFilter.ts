// Pure "which calendar day is this?" helpers for the daily-collection views.
// No I/O, no Supabase types — structural row shapes so both a full `Donation`
// and a `DonationLite` pass straight through. Only non-voided rows ever feed
// a total; amounts stay integer paise end-to-end (lib/money.ts).
//
// The one real trap: `created_at` is stored UTC, users are IST. A donation at
// 11:30 PM IST is 18:00Z the same date, one at 00:05 IST is 18:35Z the
// PREVIOUS date — so every day decision happens in the device's local
// timezone via the Date getters below. Never slice the ISO string, never
// `new Date('yyyy-mm-dd')` (that parses as UTC midnight).
import { sourceLabel } from './sources'

export type Countable = { amount_paise: number; voided: boolean }
export type DayRow = Countable & { created_at: string; mode: string; collected_by: string; category: string }

export type Totals = { totalPaise: number; count: number }
export type DaySummary = Totals & {
  byMode: Record<string, number> // keyed cash/upi/bank, always all three present
  byVolunteer: Record<string, number> // collected_by (users.id) → paise
  // Plan 2026-08-18: the day card's "by source" rows. Keyed by the source's
  // LABEL (lib/sources.ts), so a legacy 'society' row and a new 'Society' row
  // land in the same bucket instead of reading as two sources.
  bySource: Record<string, number> // label → paise
  bySourceCount: Record<string, number> // label → donation count
}

// Same local-day idiom Collections.tsx's shortTime() and CollectionForm's
// greeting chip already use — toDateString() is local-time by spec.
export function isOnLocalDay(iso: string, day: Date): boolean {
  const d = new Date(iso)
  return !Number.isNaN(d.getTime()) && d.toDateString() === day.toDateString()
}

// "2026-08-16" (an <input type="date"> value) → LOCAL midnight, or null for
// anything malformed / rolled over (a native date input never emits those,
// but the helper is the trust boundary, not the input).
export function parseLocalDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null
}

// Inverse of parseLocalDay: a Date → its LOCAL "yyyy-mm-dd" (for a date
// input's value/max). NOT toISOString().slice(0, 10) — that is the UTC date.
export function formatLocalDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function totalsOf(rows: Countable[]): Totals {
  let totalPaise = 0
  let count = 0
  for (const r of rows) {
    if (r.voided) continue
    totalPaise += r.amount_paise
    count += 1
  }
  return { totalPaise, count }
}

// One day's take: total, count, split by payment mode, source and collector.
export function summarizeDay(rows: DayRow[], day: Date): DaySummary {
  const s: DaySummary = {
    totalPaise: 0,
    count: 0,
    byMode: { cash: 0, upi: 0, bank: 0 },
    byVolunteer: {},
    bySource: {},
    bySourceCount: {},
  }
  for (const r of rows) {
    if (r.voided || !isOnLocalDay(r.created_at, day)) continue
    s.totalPaise += r.amount_paise
    s.count += 1
    s.byMode[r.mode] = (s.byMode[r.mode] ?? 0) + r.amount_paise
    s.byVolunteer[r.collected_by] = (s.byVolunteer[r.collected_by] ?? 0) + r.amount_paise
    const source = sourceLabel(r.category)
    s.bySource[source] = (s.bySource[source] ?? 0) + r.amount_paise
    s.bySourceCount[source] = (s.bySourceCount[source] ?? 0) + 1
  }
  return s
}

// Which local days actually have money on them — the dots on the day tiles and
// on the picker's calendar grid. Keys are formatLocalDay strings, so a lookup is
// exact and needs no re-parsing. Voided rows never light a day: the dot claims
// "there is a collection here", and a voided row is not one.
export function daysWithCollections(rows: DayRow[]): Set<string> {
  const days = new Set<string>()
  for (const r of rows) {
    if (r.voided) continue
    const d = new Date(r.created_at)
    if (Number.isNaN(d.getTime())) continue
    days.add(formatLocalDay(d))
  }
  return days
}
