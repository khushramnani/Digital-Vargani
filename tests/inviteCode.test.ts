import { describe, it, expect } from 'vitest'
import { normalizeInviteCode, formatInviteCode, isInviteCode, extractInviteToken } from '../src/lib/inviteCode'

// The whole point of the code is that it survives being retyped by hand off
// a WhatsApp message or a phone call. Everything here is a shape someone
// will actually produce.
describe('invite code', () => {
  it('normalizes however it was typed', () => {
    for (const typed of ['K7M29XPQ4R', 'k7m29xpq4r', 'K7M29-XPQ4R', ' k7m29 xpq4r ', 'K7M29 - XPQ4R']) {
      expect(normalizeInviteCode(typed)).toBe('K7M29XPQ4R')
    }
  })

  it('groups for reading aloud, and leaves anything else alone', () => {
    expect(formatInviteCode('K7M29XPQ4R')).toBe('K7M29-XPQ4R')
    // A 64-char link token must not be chopped into a fake code shape.
    expect(formatInviteCode('a'.repeat(64))).toBe('A'.repeat(64))
  })

  it('rejects the characters the alphabet deliberately excludes', () => {
    expect(isInviteCode('K7M29XPQ4R')).toBe(true)
    // I, L, O, 0 and 1 are exactly what people get wrong by ear or by eye,
    // so the server never mints them and a code containing one is a typo.
    for (const bad of ['K7M29XPQ4I', 'K7M29XPQ4L', 'K7M29XPQ4O', 'K7M29XPQ40', 'K7M29XPQ41']) {
      expect(isInviteCode(bad)).toBe(false)
    }
    expect(isInviteCode('K7M29XPQ4')).toBe(false) // too short
  })

  describe('extractInviteToken', () => {
    const token = 'a3f9c1'.repeat(10) + 'abcd' // 64 chars

    it('takes the code out of a pasted link, current or pre-v5', () => {
      expect(extractInviteToken('https://vm.app/join/K7M29XPQ4R')).toBe('K7M29XPQ4R')
      expect(extractInviteToken(`https://vm.app/invite/${token}`)).toBe(token)
    })

    it('normalizes a bare code but passes a bare token through untouched', () => {
      expect(extractInviteToken(' k7m29-xpq4r ')).toBe('K7M29XPQ4R')
      expect(extractInviteToken(token)).toBe(token)
    })

    it('returns null only for genuinely empty input', () => {
      expect(extractInviteToken('   ')).toBeNull()
      // Anything else goes to the server, which gives the real error rather
      // than this guessing at one.
      expect(extractInviteToken('nonsense')).toBe('nonsense')
    })
  })
})
