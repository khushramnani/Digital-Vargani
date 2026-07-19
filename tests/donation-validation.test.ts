import { describe, it, expect } from 'vitest'
import { validateDonationInput, type DonationFormInput } from '../src/lib/validation/donation'

const validInput: DonationFormInput = {
  donorName: 'Ramesh Kulkarni',
  donorPhone: '+919876543210',
  amountRupees: '501',
  mode: 'cash',
}

describe('validateDonationInput', () => {
  it('accepts a fully valid input', () => {
    const result = validateDonationInput(validInput)
    expect(result).toEqual({ valid: true, errors: {} })
  })

  it('rejects an empty donor name', () => {
    const result = validateDonationInput({ ...validInput, donorName: '  ' })
    expect(result.valid).toBe(false)
    expect(result.errors.donorName).toBeDefined()
  })

  it('accepts an empty phone number (phone is optional)', () => {
    const result = validateDonationInput({ ...validInput, donorPhone: '' })
    expect(result.valid).toBe(true)
    expect(result.errors.donorPhone).toBeUndefined()
  })

  it('still rejects a non-empty phone number that is too short to be plausible', () => {
    const result = validateDonationInput({ ...validInput, donorPhone: '+9112' })
    expect(result.valid).toBe(false)
    expect(result.errors.donorPhone).toBeDefined()
  })

  it('rejects a non-numeric amount', () => {
    const result = validateDonationInput({ ...validInput, amountRupees: 'abc' })
    expect(result.valid).toBe(false)
    expect(result.errors.amountRupees).toBeDefined()
  })

  it('rejects a zero amount', () => {
    const result = validateDonationInput({ ...validInput, amountRupees: '0' })
    expect(result.valid).toBe(false)
    expect(result.errors.amountRupees).toBeDefined()
  })

  it('rejects a negative amount', () => {
    const result = validateDonationInput({ ...validInput, amountRupees: '-50' })
    expect(result.valid).toBe(false)
    expect(result.errors.amountRupees).toBeDefined()
  })

  it('rejects a missing mode', () => {
    const result = validateDonationInput({ ...validInput, mode: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.mode).toBeDefined()
  })

  it('reports every field error at once when everything is invalid', () => {
    // A too-short (but non-empty) phone so it still errors; empty phone is now
    // valid and would otherwise drop out of this set.
    const result = validateDonationInput({ donorName: '', donorPhone: '+9112', amountRupees: '', mode: '' })
    expect(result.valid).toBe(false)
    expect(Object.keys(result.errors).sort()).toEqual(['amountRupees', 'donorName', 'donorPhone', 'mode'])
  })
})
