import { describe, it, expect } from 'vitest'
import {
  toE164,
  normalizeToE164,
  parseE164,
  formatForDisplay,
  waDigits,
  isValidPhone,
} from '../src/lib/phone'

describe('toE164', () => {
  it('joins dial code + digits of the national number', () => {
    expect(toE164('91', '98765 43210')).toBe('+919876543210')
    expect(toE164('44', '(7911) 123456')).toBe('+447911123456')
  })

  it('returns "" for an empty national number (never a bare +)', () => {
    expect(toE164('91', '')).toBe('')
    expect(toE164('91', '   ')).toBe('')
  })
})

describe('normalizeToE164', () => {
  it('prepends +91 to a legacy bare 10-digit number', () => {
    expect(normalizeToE164('9876543210')).toBe('+919876543210')
    expect(normalizeToE164('98765 43210')).toBe('+919876543210')
  })

  it('leaves an already-+ number untouched (just re-stripped)', () => {
    expect(normalizeToE164('+919876543210')).toBe('+919876543210')
    expect(normalizeToE164('+44 7911 123456')).toBe('+447911123456')
  })

  it('best-effort prefixes a non-10-digit bare number with +', () => {
    expect(normalizeToE164('12025550123')).toBe('+12025550123')
  })

  it('returns "" for blank input', () => {
    expect(normalizeToE164('')).toBe('')
    expect(normalizeToE164('   ')).toBe('')
  })
})

describe('parseE164', () => {
  it('round-trips an Indian number to {91, national, IN}', () => {
    expect(parseE164('+919876543210')).toEqual({ dialCode: '91', national: '9876543210', iso: 'IN' })
  })

  it('resolves a shared dial code to the length-matching country (44 → GB)', () => {
    expect(parseE164('+447911123456')).toEqual({ dialCode: '44', national: '7911123456', iso: 'GB' })
  })

  it('falls back to IN/91 when no dial code matches', () => {
    expect(parseE164('')).toEqual({ dialCode: '91', national: '', iso: 'IN' })
  })
})

describe('formatForDisplay', () => {
  it('groups an Indian number as +91 XXXXX XXXXX', () => {
    expect(formatForDisplay('+919876543210')).toBe('+91 98765 43210')
  })

  it('uses a generic +<cc> <national> otherwise', () => {
    expect(formatForDisplay('+447911123456')).toBe('+44 7911123456')
  })

  it('returns "" for blank input', () => {
    expect(formatForDisplay('')).toBe('')
  })
})

describe('waDigits', () => {
  it('strips the + and any separators', () => {
    expect(waDigits('+919876543210')).toBe('919876543210')
    expect(waDigits('+91 98765 43210')).toBe('919876543210')
  })
})

describe('isValidPhone', () => {
  it('accepts a well-formed number matching its country length', () => {
    expect(isValidPhone('+919876543210')).toBe(true)
    expect(isValidPhone('+447911123456')).toBe(true)
  })

  it('rejects a number below the 6-digit E.164 floor', () => {
    expect(isValidPhone('+9112')).toBe(false)
  })

  it('rejects an Indian number of the wrong national length', () => {
    expect(isValidPhone('+9198765')).toBe(false)
  })
})
