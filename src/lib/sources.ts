// Donation sources (plan 2026-08-18 §1). A per-mandal, renameable list stored
// on `mandals.donation_sources`, capped at six.
//
// The one rule everything here exists to protect: renaming or removing a source
// must NEVER change a donation already in the books. That works because a NEW
// donation stores the source NAME in `donations.category`, while rows predating
// this feature carry the old 'society'/'shop'/'other' slug — so a row always
// displays the name it was recorded under, and a list edit is a list edit.
//
// Pure and framework-free (the DB and add_donation_source() enforce the same
// rules server-side); the UI only uses this for immediate feedback.

// The chip row holds six comfortably and the design says so out loud when the
// cap is hit. Same number the add_donation_source() RPC enforces.
export const MAX_SOURCES = 6

// Longest name the relaxed donations_category_check will accept.
export const MAX_SOURCE_NAME_LENGTH = 40

// Mirrors the column default in 20260818120000 — used only as the fallback when
// the read RPC hasn't answered yet, never as a source of truth.
export const DEFAULT_SOURCES: readonly string[] = ['Society', 'Shop', 'Other']

// The three values donations carried before sources became editable. A legacy
// row shows its proper label through this map; anything else is already a name.
export const LEGACY_SOURCE_LABELS: Readonly<Record<string, string>> = {
  society: 'Society',
  shop: 'Shop',
  other: 'Other',
}

// What a donation row's source chip reads. `d.srcName ?? SRC_LABEL[d.src]` from
// the design, collapsed to one column: a legacy slug maps, a name passes through.
//
// This is the trust boundary for whatever actually arrives in `category`. The
// column is NOT NULL so a real row always has one, but every caller here feeds a
// value straight off the network into string work, and one absent field used to
// take the whole Collections tab down with it. Anything that isn't a string
// becomes '' — which sourceFilterOptions then skips and matchesSource can never
// match, so an unusable value is invisible rather than fatal.
export function sourceLabel(value: string): string {
  if (typeof value !== 'string') return ''
  return LEGACY_SOURCE_LABELS[value] ?? value
}

export function canAddSource(list: readonly string[]): boolean {
  return list.length < MAX_SOURCES
}

export type SourceNameError = 'empty' | 'tooLong' | 'duplicate' | 'full'

export type SourceNameResult = { ok: true; name: string } | { ok: false; error: SourceNameError }

// Validates a new or renamed source name against the rest of the list.
// `list` is the names it must not collide with — for a rename, pass the list
// WITHOUT the row being renamed, so re-typing its own name isn't a duplicate.
// `full` is only reported for an add (checkCap), never for a rename.
export function validateSourceName(
  name: string,
  list: readonly string[],
  { checkCap = false }: { checkCap?: boolean } = {},
): SourceNameResult {
  const trimmed = name.trim()
  if (trimmed === '') return { ok: false, error: 'empty' }
  if (trimmed.length > MAX_SOURCE_NAME_LENGTH) return { ok: false, error: 'tooLong' }
  if (list.some((s) => s.trim().toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, error: 'duplicate' }
  }
  if (checkCap && !canAddSource(list)) return { ok: false, error: 'full' }
  return { ok: true, name: trimmed }
}

// The filter's option list: the mandal's current sources PLUS every source any
// visible row actually carries. A source that was renamed or removed still has
// donations recorded under its old name, and a filter option must never
// disappear while rows carry it — otherwise those rupees become unreachable.
//
// Options are labels, not raw values, so one "Society" option covers both a
// legacy 'society' row and a new "Society" row. Match rows with
// `sourceLabel(row.category) === option`; matchesSource() below does exactly that.
// Deduped case-insensitively, with the mandal's own spelling winning.
export function sourceFilterOptions(mandalList: readonly string[], rowValues: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [...mandalList, ...rowValues]) {
    const labelled = sourceLabel(raw).trim()
    if (labelled === '') continue
    const key = labelled.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(labelled)
  }
  return out
}

// One predicate for every source filter, so the list and its totals can never
// disagree. 'all' passes everything; otherwise compare labels, case-insensitively
// (an admin who retypes "society" as "Society" must not orphan the old rows).
export function matchesSource(rowValue: string, selected: string): boolean {
  if (selected === 'all') return true
  return sourceLabel(rowValue).toLowerCase() === sourceLabel(selected).toLowerCase()
}
