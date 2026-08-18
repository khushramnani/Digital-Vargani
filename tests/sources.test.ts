import { describe, it, expect } from 'vitest'
import {
  MAX_SOURCES,
  MAX_SOURCE_NAME_LENGTH,
  DEFAULT_SOURCES,
  LEGACY_SOURCE_LABELS,
  sourceLabel,
  canAddSource,
  validateSourceName,
  sourceFilterOptions,
  matchesSource,
} from '../src/lib/sources'

describe('sourceLabel', () => {
  it('maps the three legacy slugs to their proper names', () => {
    expect(sourceLabel('society')).toBe('Society')
    expect(sourceLabel('shop')).toBe('Shop')
    expect(sourceLabel('other')).toBe('Other')
  })

  it('passes a custom source name straight through', () => {
    expect(sourceLabel('Galli')).toBe('Galli')
    expect(sourceLabel('Sponsor')).toBe('Sponsor')
  })

  it('does not touch a name that merely looks like a slug in another case', () => {
    // 'Society' is already a name; only the exact lowercase slug is legacy.
    expect(sourceLabel('Society')).toBe('Society')
  })

  it('leaves an unrecognised value visible rather than blanking the chip', () => {
    expect(sourceLabel('whatever-a-future-client-sent')).toBe('whatever-a-future-client-sent')
  })

  // The column is NOT NULL, so a real row always has one — but this value comes
  // straight off the network, and one absent field used to take the whole
  // Collections tab down with a `.trim()` of undefined.
  it('returns an empty label for anything that is not a string, instead of throwing', () => {
    expect(sourceLabel(undefined as unknown as string)).toBe('')
    expect(sourceLabel(null as unknown as string)).toBe('')
    expect(sourceLabel(7 as unknown as string)).toBe('')
  })

  it('agrees with the exported legacy map', () => {
    for (const [slug, label] of Object.entries(LEGACY_SOURCE_LABELS)) {
      expect(sourceLabel(slug)).toBe(label)
    }
  })
})

describe('canAddSource', () => {
  it('allows an add below the cap and refuses one at it', () => {
    expect(canAddSource([])).toBe(true)
    expect(canAddSource(['a', 'b', 'c', 'd', 'e'])).toBe(true)
    expect(canAddSource(['a', 'b', 'c', 'd', 'e', 'f'])).toBe(false)
  })

  it('caps at six, the number the RPC and the chip row agree on', () => {
    expect(MAX_SOURCES).toBe(6)
  })

  it('defaults to the three names the column defaults to', () => {
    expect([...DEFAULT_SOURCES]).toEqual(['Society', 'Shop', 'Other'])
  })
})

describe('validateSourceName', () => {
  const list = ['Society', 'Shop', 'Other']

  it('accepts a fresh name and returns it trimmed', () => {
    expect(validateSourceName('  Galli  ', list)).toEqual({ ok: true, name: 'Galli' })
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(validateSourceName('', list)).toEqual({ ok: false, error: 'empty' })
    expect(validateSourceName('   ', list)).toEqual({ ok: false, error: 'empty' })
  })

  it('rejects a name past the 40-character column limit but accepts one exactly at it', () => {
    expect(validateSourceName('x'.repeat(MAX_SOURCE_NAME_LENGTH), list)).toEqual({
      ok: true,
      name: 'x'.repeat(MAX_SOURCE_NAME_LENGTH),
    })
    expect(validateSourceName('x'.repeat(MAX_SOURCE_NAME_LENGTH + 1), list)).toEqual({
      ok: false,
      error: 'tooLong',
    })
  })

  it('measures length after trimming, so trailing spaces do not fail a legal name', () => {
    expect(validateSourceName(`${'x'.repeat(MAX_SOURCE_NAME_LENGTH)}   `, list)).toEqual({
      ok: true,
      name: 'x'.repeat(MAX_SOURCE_NAME_LENGTH),
    })
  })

  it('rejects a duplicate regardless of case or surrounding space', () => {
    expect(validateSourceName('shop', list)).toEqual({ ok: false, error: 'duplicate' })
    expect(validateSourceName('  SHOP ', list)).toEqual({ ok: false, error: 'duplicate' })
  })

  it('compares against list entries with their own whitespace trimmed', () => {
    expect(validateSourceName('Shop', ['  Shop  '])).toEqual({ ok: false, error: 'duplicate' })
  })

  it('reports the cap only when asked to check it (an add, not a rename)', () => {
    const full = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(validateSourceName('g', full, { checkCap: true })).toEqual({ ok: false, error: 'full' })
    expect(validateSourceName('g', full)).toEqual({ ok: true, name: 'g' })
  })

  it('reports a duplicate ahead of the cap, so the message names the real problem', () => {
    const full = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(validateSourceName('A', full, { checkCap: true })).toEqual({ ok: false, error: 'duplicate' })
  })

  it('lets a rename keep its own name (caller excludes the row being renamed)', () => {
    const others = ['Shop', 'Other']
    expect(validateSourceName('Society', others)).toEqual({ ok: true, name: 'Society' })
  })
})

describe('sourceFilterOptions', () => {
  it('is just the mandal list when every row uses it', () => {
    expect(sourceFilterOptions(['Society', 'Shop'], ['Society', 'Shop', 'Society'])).toEqual([
      'Society',
      'Shop',
    ])
  })

  it('folds legacy slugs into the mandal list rather than duplicating them', () => {
    expect(sourceFilterOptions(['Society', 'Shop', 'Other'], ['society', 'shop', 'other'])).toEqual([
      'Society',
      'Shop',
      'Other',
    ])
  })

  it('keeps a REMOVED source as an option while rows still carry it', () => {
    // 'Shop' was deleted from the mandal's list; its donations are still there.
    expect(sourceFilterOptions(['Society', 'Other'], ['Society', 'Shop'])).toEqual([
      'Society',
      'Other',
      'Shop',
    ])
  })

  it('keeps a RENAMED source reachable alongside its new name', () => {
    // 'Society' was renamed to 'Galli'; past rows still say society.
    expect(sourceFilterOptions(['Galli', 'Shop', 'Other'], ['society', 'Galli'])).toEqual([
      'Galli',
      'Shop',
      'Other',
      'Society',
    ])
  })

  it("prefers the mandal's own spelling on a case-only difference", () => {
    expect(sourceFilterOptions(['Sponsor'], ['SPONSOR', 'sponsor'])).toEqual(['Sponsor'])
  })

  it('drops blank values instead of offering an unlabelled option', () => {
    expect(sourceFilterOptions(['Society'], ['', '   ', 'Shop'])).toEqual(['Society', 'Shop'])
  })

  it('handles an empty mandal list by deriving options entirely from the rows', () => {
    expect(sourceFilterOptions([], ['shop', 'Galli'])).toEqual(['Shop', 'Galli'])
  })

  it('returns nothing when there is nothing to offer', () => {
    expect(sourceFilterOptions([], [])).toEqual([])
  })

  it('skips a row whose category is missing rather than throwing', () => {
    expect(sourceFilterOptions(['Society'], [undefined as unknown as string, 'Shop'])).toEqual(['Society', 'Shop'])
  })
})

describe('matchesSource', () => {
  it('passes everything for "all"', () => {
    expect(matchesSource('society', 'all')).toBe(true)
    expect(matchesSource('Galli', 'all')).toBe(true)
  })

  it('matches a legacy slug row against the labelled option', () => {
    expect(matchesSource('society', 'Society')).toBe(true)
    expect(matchesSource('shop', 'Society')).toBe(false)
  })

  it('matches a custom-name row against its own option', () => {
    expect(matchesSource('Galli', 'Galli')).toBe(true)
    expect(matchesSource('Galli', 'Shop')).toBe(false)
  })

  it('is case-insensitive, so a re-cased rename never orphans past rows', () => {
    expect(matchesSource('Society', 'society')).toBe(true)
    expect(matchesSource('SPONSOR', 'sponsor')).toBe(true)
  })

  it('never matches a missing category against a real option', () => {
    expect(matchesSource(undefined as unknown as string, 'Society')).toBe(false)
    // ...but "all" still means all, including a row we cannot label.
    expect(matchesSource(undefined as unknown as string, 'all')).toBe(true)
  })
})
