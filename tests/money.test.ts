import { describe, it, expect } from 'vitest'
import { toPaise, formatINR, toRupees } from '../src/lib/money'

describe('toPaise', () => {
  it('converts whole rupees to paise', () => {
    expect(toPaise(100)).toBe(10000)
  })

  it('rounds fractional rupees that hit floating-point imprecision', () => {
    // 10.005 * 100 === 1000.5000000000001 in IEEE-754 double math, so this
    // rounds up to 1001 — assert the actual computed result, not the naive
    // "1000.5 rounds to 1000 or 1001" intuition.
    expect(toPaise(10.005)).toBe(1001)
  })

  it('converts zero rupees to zero paise', () => {
    expect(toPaise(0)).toBe(0)
  })

  it('converts large amounts (lakhs) to paise', () => {
    expect(toPaise(100000)).toBe(10000000)
  })
})

describe('formatINR', () => {
  it('formats whole rupees with the rupee sign', () => {
    expect(formatINR(10000)).toBe('₹100')
  })

  it('formats zero paise', () => {
    expect(formatINR(0)).toBe('₹0')
  })

  it('groups lakhs using en-IN digit grouping', () => {
    // ₹1,00,000 (Indian grouping), not ₹100,000 (Western grouping)
    expect(formatINR(10000000)).toBe('₹1,00,000')
  })

  it('groups crores using en-IN digit grouping', () => {
    expect(formatINR(1000000000)).toBe('₹1,00,00,000')
  })
})

describe('toRupees', () => {
  it('converts paise to rupees without rounding', () => {
    expect(toRupees(12345)).toBe(123.45)
  })

  it('converts zero paise to zero rupees', () => {
    expect(toRupees(0)).toBe(0)
  })

  it('round-trips with toPaise for values with no sub-paise fraction', () => {
    expect(toRupees(toPaise(250))).toBe(250)
    expect(toPaise(toRupees(25000))).toBe(25000)
  })
})
