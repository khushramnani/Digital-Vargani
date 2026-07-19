import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildSmsLink, buildWhatsAppLink, receiptUrl, buildReceiptMessage } from '../src/features/collection/send'
import { normalizeToE164 } from '../src/lib/phone'
import type { Donation } from '../src/lib/db/donations'
import { LANGS } from '../src/lib/i18n/receipt'

function stubUserAgent(userAgent: string) {
  vi.stubGlobal('navigator', { ...navigator, userAgent })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('receiptUrl', () => {
  // F4: the receipt number rides in front of the token as a human-friendly
  // prefix; the full token still follows and is the access gate. lang is a
  // required parameter — a default is how a caller silently sends English
  // forever.
  it.each(LANGS)('carries the receipt-number prefix and lang=%s on the link', (lang) => {
    expect(receiptUrl(123, 'tok123', lang)).toBe(`${window.location.origin}/r/123-tok123?lang=${lang}`)
  })
})

describe('buildReceiptMessage', () => {
  it('embeds the pretty /r/<receiptNo>-<token> link and the rupee amount in the donor message', () => {
    const donation = { amount_paise: 50100, receipt_no: 42, public_token: 'tok-abc' } as unknown as Donation
    const message = buildReceiptMessage(donation, 'en')
    expect(message).toContain(`${window.location.origin}/r/42-tok-abc?lang=en`)
    expect(message).toContain('₹501')
  })
})

describe('buildSmsLink', () => {
  it('uses the Android/default ?body= separator and url-encodes the message', () => {
    stubUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36')

    const link = buildSmsLink('9876543210', 'Thank you & regards, receipt: https://x/r/tok')

    expect(link).toBe(
      `sms:9876543210?body=${encodeURIComponent('Thank you & regards, receipt: https://x/r/tok')}`,
    )
  })

  it('uses the iOS &body= separator for iPhone user agents', () => {
    stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')

    const link = buildSmsLink('9876543210', 'Hello')

    expect(link).toBe('sms:9876543210&body=Hello')
  })

  it('uses the iOS &body= separator for iPad and iPod user agents too', () => {
    stubUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15')
    expect(buildSmsLink('123', 'x')).toBe('sms:123&body=x')

    stubUserAgent('Mozilla/5.0 (iPod touch; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')
    expect(buildSmsLink('123', 'x')).toBe('sms:123&body=x')
  })

  it('includes the phone number as given, unmodified', () => {
    stubUserAgent('Mozilla/5.0 (Linux; Android 13)')

    const link = buildSmsLink('+919876543210', 'msg')

    expect(link.startsWith('sms:+919876543210')).toBe(true)
  })
})

describe('buildWhatsAppLink', () => {
  // The 10-digit heuristic is dead: the input is E.164 (from PhoneInput, or via
  // normalizeToE164 for legacy rows). buildWhatsAppLink just strips the +.
  it('strips the + from an E.164 number for the wa.me target', () => {
    const link = buildWhatsAppLink('+919876543210', 'Hello')
    expect(link).toBe('https://wa.me/919876543210?text=Hello')
  })

  it('sends a normalized legacy 10-digit number to the right +91 target', () => {
    const link = buildWhatsAppLink(normalizeToE164('9876543210'), 'Hello')
    expect(link).toBe('https://wa.me/919876543210?text=Hello')
  })

  it('routes an international +44 number to its own country target', () => {
    const link = buildWhatsAppLink('+447911123456', 'Hello')
    expect(link).toBe('https://wa.me/447911123456?text=Hello')
  })

  it('strips spaces and symbols from a display-formatted E.164 value', () => {
    const link = buildWhatsAppLink('+91 98765 43210', 'Hello')
    expect(link).toBe('https://wa.me/919876543210?text=Hello')
  })

  it('url-encodes the message the same way buildSmsLink does', () => {
    const link = buildWhatsAppLink('+919876543210', 'Thank you & regards, receipt: https://x/r/tok')
    expect(link).toBe(
      `https://wa.me/919876543210?text=${encodeURIComponent('Thank you & regards, receipt: https://x/r/tok')}`,
    )
  })
})
