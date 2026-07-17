import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildSmsLink, buildWhatsAppLink } from '../src/features/collection/send'

function stubUserAgent(userAgent: string) {
  vi.stubGlobal('navigator', { ...navigator, userAgent })
}

afterEach(() => {
  vi.unstubAllGlobals()
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
  it('prepends 91 to a bare 10-digit number', () => {
    const link = buildWhatsAppLink('9876543210', 'Hello')
    expect(link).toBe('https://wa.me/919876543210?text=Hello')
  })

  it('strips spaces/dashes/parens before checking the digit count', () => {
    const link = buildWhatsAppLink('(987) 654-3210', 'Hello')
    expect(link).toBe('https://wa.me/919876543210?text=Hello')
  })

  it('leaves an already-prefixed international number unmodified (no re-prepending 91)', () => {
    const link = buildWhatsAppLink('+919876543210', 'Hello')
    expect(link).toBe('https://wa.me/919876543210?text=Hello')
  })

  it('leaves a non-10-digit number as-is rather than guessing a prefix', () => {
    const link = buildWhatsAppLink('12025550123', 'Hello')
    expect(link).toBe('https://wa.me/12025550123?text=Hello')
  })

  it('url-encodes the message the same way buildSmsLink does', () => {
    const link = buildWhatsAppLink('9876543210', 'Thank you & regards, receipt: https://x/r/tok')
    expect(link).toBe(
      `https://wa.me/919876543210?text=${encodeURIComponent('Thank you & regards, receipt: https://x/r/tok')}`,
    )
  })
})
