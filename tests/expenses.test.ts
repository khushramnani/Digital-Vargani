import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createExpense, getExpenses, voidExpense } from '../src/lib/db/expenses'
import type { Tables } from '../src/lib/db/database.types'

// No live Supabase project exists (same constraint as every prior task's
// tests) — mock the client's `from` chain directly to prove expenses.ts
// builds the right query/payload shape, same style as tests/config.test.ts.
const { from } = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('../src/lib/db/client', () => ({
  supabase: { from },
}))

const expenseRow: Tables<'expenses'> = {
  id: 'expense-1',
  category: 'Mandap',
  amount_paise: 250000,
  description: 'Tent rental',
  paid_by: 'volunteer-1',
  paid_from: 'cash',
  created_at: '2026-01-01T00:00:00Z',
  voided: false,
  void_reason: null,
  voided_by: null,
  voided_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createExpense', () => {
  it('inserts amount_paise/paid_from/paid_by, never receipt-style server fields', async () => {
    const single = vi.fn(() => Promise.resolve({ data: expenseRow, error: null }))
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    from.mockReturnValue({ insert })

    const result = await createExpense({
      category: 'Mandap',
      description: 'Tent rental',
      amountPaise: 250000,
      paidFrom: 'cash',
      paidBy: 'volunteer-1',
    })

    expect(from).toHaveBeenCalledWith('expenses')
    expect(insert).toHaveBeenCalledWith({
      category: 'Mandap',
      description: 'Tent rental',
      amount_paise: 250000,
      paid_from: 'cash',
      paid_by: 'volunteer-1',
    })
    expect(result).toEqual(expenseRow)
  })

  it('sends a null description rather than an empty string', async () => {
    const single = vi.fn(() => Promise.resolve({ data: expenseRow, error: null }))
    const insert = vi.fn(() => ({ select: () => ({ single }) }))
    from.mockReturnValue({ insert })

    await createExpense({ category: 'Mandap', description: '', amountPaise: 100, paidFrom: 'bank', paidBy: 'v-1' })

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ description: null }))
  })

  it('throws when the insert errors (e.g. RLS rejects a mismatched paid_by)', async () => {
    const single = vi.fn(() => Promise.resolve({ data: null, error: new Error('permission denied') }))
    from.mockReturnValue({ insert: () => ({ select: () => ({ single }) }) })

    await expect(
      createExpense({ category: 'Mandap', description: '', amountPaise: 100, paidFrom: 'cash', paidBy: 'v-1' }),
    ).rejects.toThrow('permission denied')
  })
})

describe('getExpenses', () => {
  it('selects all columns plus the joined payer name, most recent first', async () => {
    const order = vi.fn(() => Promise.resolve({ data: [expenseRow], error: null }))
    const select = vi.fn(() => ({ order }))
    from.mockReturnValue({ select })

    const result = await getExpenses()

    expect(from).toHaveBeenCalledWith('expenses')
    expect(select).toHaveBeenCalledWith(expect.stringContaining('paid_by_user:users!expenses_paid_by_fkey'))
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(result).toEqual([expenseRow])
  })

  it('returns an empty array (not null) when there are no rows', async () => {
    const order = vi.fn(() => Promise.resolve({ data: null, error: null }))
    from.mockReturnValue({ select: () => ({ order }) })

    expect(await getExpenses()).toEqual([])
  })

  it('throws when the query errors', async () => {
    const order = vi.fn(() => Promise.resolve({ data: null, error: new Error('boom') }))
    from.mockReturnValue({ select: () => ({ order }) })

    await expect(getExpenses()).rejects.toThrow('boom')
  })
})

describe('voidExpense', () => {
  it('sets exactly voided/void_reason/voided_by/voided_at, filtered by id', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ eq }))
    from.mockReturnValue({ update })

    await voidExpense('expense-1', 'Wrong category', 'admin-1')

    expect(from).toHaveBeenCalledWith('expenses')
    expect(update).toHaveBeenCalledWith({
      voided: true,
      void_reason: 'Wrong category',
      voided_by: 'admin-1',
      voided_at: expect.any(String),
    })
    expect(eq).toHaveBeenCalledWith('id', 'expense-1')
  })

  it('throws when the update errors', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: new Error('permission denied') }))
    from.mockReturnValue({ update: () => ({ eq }) })

    await expect(voidExpense('expense-1', 'reason', 'admin-1')).rejects.toThrow('permission denied')
  })
})
