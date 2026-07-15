import { describe, it, expect } from 'vitest'
import { validateExpenseInput, type ExpenseFormInput } from '../src/lib/validation/expense'

const categories = ['Mandap', 'Prasad']

const validInput: ExpenseFormInput = {
  category: 'Mandap',
  description: 'Tent rental',
  amountRupees: '2500',
  paidFrom: 'cash',
}

describe('validateExpenseInput', () => {
  it('accepts a fully valid input', () => {
    const result = validateExpenseInput(validInput, categories)
    expect(result).toEqual({ valid: true, errors: {} })
  })

  it('rejects an empty category', () => {
    const result = validateExpenseInput({ ...validInput, category: '' }, categories)
    expect(result.valid).toBe(false)
    expect(result.errors.category).toBeDefined()
  })

  it('rejects a category not in the mandal-configured list', () => {
    const result = validateExpenseInput({ ...validInput, category: 'Not A Real Category' }, categories)
    expect(result.valid).toBe(false)
    expect(result.errors.category).toBeDefined()
  })

  it('rejects a zero amount', () => {
    const result = validateExpenseInput({ ...validInput, amountRupees: '0' }, categories)
    expect(result.valid).toBe(false)
    expect(result.errors.amountRupees).toBeDefined()
  })

  it('rejects a negative amount', () => {
    const result = validateExpenseInput({ ...validInput, amountRupees: '-10' }, categories)
    expect(result.valid).toBe(false)
    expect(result.errors.amountRupees).toBeDefined()
  })

  it('rejects a non-numeric amount', () => {
    const result = validateExpenseInput({ ...validInput, amountRupees: 'abc' }, categories)
    expect(result.valid).toBe(false)
    expect(result.errors.amountRupees).toBeDefined()
  })

  it('rejects a missing paidFrom', () => {
    const result = validateExpenseInput({ ...validInput, paidFrom: '' }, categories)
    expect(result.valid).toBe(false)
    expect(result.errors.paidFrom).toBeDefined()
  })

  it('reports every field error at once when everything is invalid', () => {
    const result = validateExpenseInput({ category: '', description: '', amountRupees: '', paidFrom: '' }, categories)
    expect(result.valid).toBe(false)
    expect(Object.keys(result.errors).sort()).toEqual(['amountRupees', 'category', 'paidFrom'])
  })
})
