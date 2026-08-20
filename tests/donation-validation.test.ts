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

  // Plan 2026-08-18 §2: a phone-less donation is still loggable, but only when
  // the volunteer says so. A silently-blank field used to save as "no phone",
  // so a mistyped number cost the donor their receipt with nothing on screen
  // explaining why.
  it('rejects an empty phone number when the volunteer has not skipped it', () => {
    const result = validateDonationInput({ ...validInput, donorPhone: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.donorPhone).toBeDefined()
  })

  it('accepts an empty phone number once skipPhone is on', () => {
    const result = validateDonationInput({ ...validInput, donorPhone: '', skipPhone: true })
    expect(result).toEqual({ valid: true, errors: {} })
  })

  it('ignores a half-typed phone entirely when skipPhone is on', () => {
    // The form clears the field when the toggle flips, but a stale value must
    // never be able to block a deliberate "no receipt" save.
    const result = validateDonationInput({ ...validInput, donorPhone: '+9112', skipPhone: true })
    expect(result).toEqual({ valid: true, errors: {} })
  })

  it('treats an absent skipPhone as false', () => {
    // validInput carries no skipPhone at all, so this is the "old callers keep
    // compiling, and keep the strict behaviour" case.
    expect('skipPhone' in validInput).toBe(false)
    const result = validateDonationInput({ ...validInput, donorPhone: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.donorPhone).toBeDefined()
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
    const result = validateDonationInput({ donorName: '', donorPhone: '+9112', amountRupees: '', mode: '' })
    expect(result.valid).toBe(false)
    expect(Object.keys(result.errors).sort()).toEqual(['amountRupees', 'donorName', 'donorPhone', 'mode'])
  })
})
