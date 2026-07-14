import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildSmsLink } from '../src/features/collection/send'

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
