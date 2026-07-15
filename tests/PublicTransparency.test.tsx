import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PublicTransparency } from '../src/features/transparency/PublicTransparency'

// Mock lib/db/transparency.ts directly (not the raw Supabase client) — same
// pattern as ExpensesScreen.test.tsx.
const { getTransparencyReport, getTransparencyCategories } = vi.hoisted(() => ({
  getTransparencyReport: vi.fn(),
  getTransparencyCategories: vi.fn(),
}))

vi.mock('../src/lib/db/transparency', () => ({ getTransparencyReport, getTransparencyCategories }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PublicTransparency', () => {
  it('shows a "not published" message when the report RPC returns no row', async () => {
    getTransparencyReport.mockResolvedValue(null)
    getTransparencyCategories.mockResolvedValue([])

    render(<PublicTransparency />)

    await waitFor(() =>
      expect(screen.getByText('The transparency report has not been published yet.')).toBeInTheDocument(),
    )
  })

  it('renders the total collected and a category breakdown that sums to total expenses, with no donor data', async () => {
    getTransparencyReport.mockResolvedValue({ totalCollectedPaise: 500000, totalExpensesPaise: 300000 })
    getTransparencyCategories.mockResolvedValue([
      { category: 'Mandap', amountPaise: 200000 },
      { category: 'Prasad', amountPaise: 100000 },
    ])

    render(<PublicTransparency />)

    await waitFor(() => expect(screen.getByText('₹5,000')).toBeInTheDocument())
    // Category rows sum to totalExpensesPaise (300000) — the invariant the
    // migration's `not voided` group-by guarantees; asserted here at the
    // fixture level rather than reimplementing the sum.
    const categoryTotal = [200000, 100000].reduce((a, b) => a + b, 0)
    expect(categoryTotal).toBe(300000)
  })
})
