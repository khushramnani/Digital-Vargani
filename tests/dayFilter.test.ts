import { describe, it, expect } from 'vitest'
import { isOnLocalDay, parseLocalDay, formatLocalDay, summarizeDay, totalsOf } from '../src/lib/dayFilter'

// vite.config.ts pins TZ=Asia/Kolkata for the whole unit suite, so the IST
// boundary cases below are deterministic on any machine — that pin is what
// makes "18:35Z is Aug 16" a fact rather than a coincidence of the dev box.

const row = (over: Partial<Parameters<typeof summarizeDay>[0][number]> = {}) => ({
  amount_paise: 10000,
  voided: false,
  created_at: '2026-08-16T04:30:00Z', // 10:00 IST, Aug 16
  mode: 'cash',
  collected_by: 'v-1',
  ...over,
})

describe('isOnLocalDay', () => {
  const aug16 = new Date(2026, 7, 16) // local midnight

  it('counts a donation at 00:05 IST as that local day, not the UTC date', () => {
    // 18:35Z on Aug 15 == 00:05 IST on Aug 16 — the substring(0,10) trap.
    expect(isOnLocalDay('2026-08-15T18:35:00Z', aug16)).toBe(true)
    expect(isOnLocalDay('2026-08-15T18:35:00Z', new Date(2026, 7, 15))).toBe(false)
  })

  it('counts a donation at 11:55 PM IST as that local day', () => {
    // 18:25Z on Aug 16 == 23:55 IST on Aug 16.
    expect(isOnLocalDay('2026-08-16T18:25:00Z', aug16)).toBe(true)
    // 18:35Z on Aug 16 == 00:05 IST on Aug 17 — no longer Aug 16.
    expect(isOnLocalDay('2026-08-16T18:35:00Z', aug16)).toBe(false)
  })

  it('ignores the time-of-day of the reference date', () => {
    expect(isOnLocalDay('2026-08-16T04:30:00Z', new Date(2026, 7, 16, 23, 59))).toBe(true)
  })

  it('never matches an unparseable timestamp', () => {
    expect(isOnLocalDay('not-a-date', aug16)).toBe(false)
  })
})

describe('parseLocalDay', () => {
  it('parses a yyyy-mm-dd input as LOCAL midnight (not UTC)', () => {
    const d = parseLocalDay('2026-08-16')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(7)
    expect(d!.getDate()).toBe(16)
    expect(d!.getHours()).toBe(0)
    // The trap: new Date('2026-08-16') is 05:30 IST on the 16th, but for a
    // west-of-UTC user it would be the 15th — parseLocalDay never does that.
    expect(d!.getTime()).toBe(new Date(2026, 7, 16).getTime())
  })

  it('returns null for empty, malformed or rolled-over inputs', () => {
    expect(parseLocalDay('')).toBeNull()
    expect(parseLocalDay('16/08/2026')).toBeNull()
    expect(parseLocalDay('2026-8-16')).toBeNull()
    expect(parseLocalDay('2026-02-31')).toBeNull()
    expect(parseLocalDay('2026-13-01')).toBeNull()
  })

  it('round-trips through formatLocalDay', () => {
    expect(formatLocalDay(parseLocalDay('2026-01-05')!)).toBe('2026-01-05')
    expect(formatLocalDay(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })
})

describe('summarizeDay', () => {
  const aug16 = new Date(2026, 7, 16)

  it('returns zeros for an empty day', () => {
    expect(summarizeDay([], aug16)).toEqual({
      totalPaise: 0,
      count: 0,
      byMode: { cash: 0, upi: 0, bank: 0 },
      byVolunteer: {},
    })
    // Rows exist, but none on this day.
    expect(summarizeDay([row({ created_at: '2026-08-14T04:30:00Z' })], aug16).count).toBe(0)
  })

  it('excludes voided rows and rows from other days', () => {
    const s = summarizeDay(
      [
        row({ amount_paise: 50000 }),
        row({ amount_paise: 99999, voided: true }),
        row({ amount_paise: 77777, created_at: '2026-08-15T04:30:00Z' }),
      ],
      aug16,
    )
    expect(s.totalPaise).toBe(50000)
    expect(s.count).toBe(1)
  })

  it('splits by payment mode and by collector, in integer paise', () => {
    const s = summarizeDay(
      [
        row({ amount_paise: 10001, mode: 'cash', collected_by: 'v-1' }),
        row({ amount_paise: 20002, mode: 'upi', collected_by: 'v-1' }),
        row({ amount_paise: 30003, mode: 'bank', collected_by: 'v-2' }),
        row({ amount_paise: 40004, mode: 'cash', collected_by: 'v-2' }),
        // IST-midnight edge: 18:35Z Aug 15 is 00:05 IST Aug 16 — counts.
        row({ amount_paise: 5, mode: 'cash', collected_by: 'v-3', created_at: '2026-08-15T18:35:00Z' }),
      ],
      aug16,
    )
    expect(s.totalPaise).toBe(100015)
    expect(s.count).toBe(5)
    expect(s.byMode).toEqual({ cash: 50010, upi: 20002, bank: 30003 })
    expect(s.byVolunteer).toEqual({ 'v-1': 30003, 'v-2': 70007, 'v-3': 5 })
  })
})

describe('totalsOf', () => {
  it('sums non-voided rows only', () => {
    expect(
      totalsOf([
        { amount_paise: 100, voided: false },
        { amount_paise: 250, voided: true },
        { amount_paise: 1, voided: false },
      ]),
    ).toEqual({ totalPaise: 101, count: 2 })
  })

  it('is zero for no rows', () => {
    expect(totalsOf([])).toEqual({ totalPaise: 0, count: 0 })
  })
})
