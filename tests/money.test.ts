import { describe, it, expect } from 'vitest'
import { toPaise, formatINR, toRupees, splitINR, formatPct } from '../src/lib/money'

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
  it('formats whole rupees with two fraction digits', () => {
    expect(formatINR(10000)).toBe('₹100.00')
  })

  it('formats zero paise', () => {
    expect(formatINR(0)).toBe('₹0.00')
  })

  it('keeps two fraction digits for a half-rupee (never ₹10.5)', () => {
    expect(formatINR(1050)).toBe('₹10.50')
  })

  it('places the sign before the rupee symbol for a negative amount', () => {
    expect(formatINR(-4000)).toBe('-₹40.00')
  })

  it('groups lakhs using en-IN digit grouping', () => {
    // ₹1,00,000 (Indian grouping), not ₹100,000 (Western grouping)
    expect(formatINR(10000000)).toBe('₹1,00,000.00')
  })

  it('groups crores using en-IN digit grouping', () => {
    expect(formatINR(1000000000)).toBe('₹1,00,00,000.00')
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

describe('splitINR', () => {
  it('splits whole rupees from the paise tail', () => {
    expect(splitINR(10000)).toEqual({ main: '₹100', dec: '.00' })
  })

  it('carries the paise', () => {
    expect(splitINR(1050)).toEqual({ main: '₹10', dec: '.50' })
    expect(splitINR(1005)).toEqual({ main: '₹10', dec: '.05' })
  })

  it('splits zero', () => {
    expect(splitINR(0)).toEqual({ main: '₹0', dec: '.00' })
  })

  it('places the sign before the rupee symbol, like formatINR', () => {
    expect(splitINR(-4000)).toEqual({ main: '-₹40', dec: '.00' })
    expect(splitINR(-4050)).toEqual({ main: '-₹40', dec: '.50' })
  })

  it('groups lakhs and crores using en-IN digit grouping', () => {
    expect(splitINR(10000000).main).toBe('₹1,00,000')
    expect(splitINR(1000000000).main).toBe('₹1,00,00,000')
  })

  it('reassembles into exactly formatINR for every shape', () => {
    for (const paise of [0, 1, 99, 100, 1050, 1005, -1, -4050, 10000000, 1000000000, -1000000000]) {
      const { main, dec } = splitINR(paise)
      expect(main + dec).toBe(formatINR(paise))
    }
  })
})

describe('formatPct', () => {
  it('formats a whole-percent share', () => {
    expect(formatPct(50, 200)).toBe('25%')
    expect(formatPct(200, 200)).toBe('100%')
  })

  it('rounds to the nearest whole percent', () => {
    expect(formatPct(1, 3)).toBe('33%')
    expect(formatPct(2, 3)).toBe('67%')
  })

  it('is 0% for a zero or negative total, never NaN or Infinity', () => {
    expect(formatPct(0, 0)).toBe('0%')
    expect(formatPct(100, 0)).toBe('0%')
    expect(formatPct(100, -5)).toBe('0%')
  })

  it('is 0% for a zero value', () => {
    expect(formatPct(0, 200)).toBe('0%')
  })
})
