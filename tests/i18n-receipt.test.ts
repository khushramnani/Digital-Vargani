import { describe, it, expect } from 'vitest'
import { toLang, receiptStrings, LANGS } from '../src/lib/i18n/receipt'

describe('toLang', () => {
  it('accepts every supported language code', () => {
    for (const lang of LANGS) expect(toLang(lang)).toBe(lang)
  })

  // This reads a URL a donor could have mangled, so every bad input is a
  // fallback, never a throw.
  it.each([
    ['unknown code', 'xx'],
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a path traversal attempt', '../../etc/passwd'],
    ['wrong case', 'MR'],
  ])('falls back to English for %s', (_label, value) => {
    expect(toLang(value as string | null | undefined)).toBe('en')
  })
})

describe('receiptStrings', () => {
  it('English copy is unchanged from the pre-i18n strings', () => {
    expect(receiptStrings.en.notFound).toBe('Receipt not found.')
    expect(receiptStrings.en.stampCash).toBe('RECEIVED: CASH')
    expect(receiptStrings.en.signatureLabel).toBe('President')
    expect(receiptStrings.en.smsMessage(500, 'https://x.test/r/abc')).toBe(
      'Thank you for your ₹500 contribution. View your official receipt here: https://x.test/r/abc',
    )
  })
})

describe('every language is complete', () => {
  it.each(LANGS)('%s has every receipt string, non-empty', (lang) => {
    const s = receiptStrings[lang]
    expect(s).toBeDefined()
    const keys: (keyof typeof s)[] = [
      'notFound', 'donorLabel', 'amountLabel', 'receiptNoLabel', 'dateLabel',
      'stampCash', 'stampOnline', 'voidedBanner', 'voidedReasonPrefix', 'signatureLabel',
    ]
    for (const key of keys) {
      expect(typeof s[key], `${lang}.${String(key)}`).toBe('string')
      expect((s[key] as string).length, `${lang}.${String(key)}`).toBeGreaterThan(0)
    }
    const msg = s.smsMessage(500, 'https://x.test/r/abc')
    expect(msg).toContain('500')
    expect(msg).toContain('https://x.test/r/abc')
  })
})
