import { describe, it, expect } from 'vitest'
import { validateDonationInput, type DonationFormInput } from '../src/lib/validation/donation'

const validInput: DonationFormInput = {
  donorName: 'Ramesh Kulkarni',
  donorPhone: '9876543210',
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

  it('rejects an empty phone number', () => {
    const result = validateDonationInput({ ...validInput, donorPhone: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.donorPhone).toBeDefined()
  })

  it('rejects a phone number that is too short to be plausible', () => {
    const result = validateDonationInput({ ...validInput, donorPhone: '12345' })
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
    const result = validateDonationInput({ donorName: '', donorPhone: '', amountRupees: '', mode: '' })
    expect(result.valid).toBe(false)
    expect(Object.keys(result.errors).sort()).toEqual(['amountRupees', 'donorName', 'donorPhone', 'mode'])
  })
})
