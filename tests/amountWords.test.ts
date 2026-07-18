import { describe, it, expect } from 'vitest'
import { amountInWords } from '../src/lib/amountWords'

describe('amountInWords', () => {
  it('names units, teens, and tens', () => {
    expect(amountInWords(100)).toBe('one') // ₹1
    expect(amountInWords(1500)).toBe('fifteen') // ₹15
    expect(amountInWords(4200)).toBe('forty two') // ₹42
  })

  it('handles hundreds (the common donation case)', () => {
    expect(amountInWords(50100)).toBe('five hundred one') // ₹501
    expect(amountInWords(25100)).toBe('two hundred fifty one') // ₹251
  })

  it('uses Indian grouping (thousand / lakh / crore)', () => {
    expect(amountInWords(210000)).toBe('two thousand one hundred') // ₹2,100
    expect(amountInWords(10000000)).toBe('one lakh') // ₹1,00,000
    expect(amountInWords(1_00_00_000_00)).toBe('one crore') // ₹1,00,00,000
  })

  it('appends paise when there is a fractional remainder', () => {
    expect(amountInWords(5050)).toBe('fifty and fifty paise') // ₹50.50
    expect(amountInWords(101)).toBe('one and one paise') // ₹1.01
  })

  it('is zero for zero, and ignores sign', () => {
    expect(amountInWords(0)).toBe('zero')
    expect(amountInWords(-50100)).toBe('five hundred one')
  })
})
