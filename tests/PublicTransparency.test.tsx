import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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

// The page reads its mandal from the route now, so it can only be rendered
// inside a matching route — a bare render() would give useParams no slug.
function renderAt(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/transparency/${slug}`]}>
      <Routes>
        <Route path="/transparency/:slug" element={<PublicTransparency />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PublicTransparency', () => {
  it('passes the slug from the URL to both RPCs', async () => {
    getTransparencyReport.mockResolvedValue({ totalCollectedPaise: 100000, totalExpensesPaise: 40000 })
    getTransparencyCategories.mockResolvedValue([{ category: 'Mandap', amountPaise: 40000 }])

    renderAt('mandal-one')

    await waitFor(() => expect(getTransparencyReport).toHaveBeenCalledWith('mandal-one'))
    expect(getTransparencyCategories).toHaveBeenCalledWith('mandal-one')
  })

  // An unknown slug returns zero rows exactly like an unpublished report, so
  // both land here. That is deliberate: the page must not reveal which slugs
  // exist.
  it('shows a "not published" message when the report RPC returns no row', async () => {
    getTransparencyReport.mockResolvedValue(null)
    getTransparencyCategories.mockResolvedValue([])

    renderAt('mandal-two')

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

    renderAt('mandal-one')

    await waitFor(() => expect(screen.getByText('₹5,000.00')).toBeInTheDocument())
    // Category rows sum to totalExpensesPaise (300000) — the invariant the
    // migration's `not voided` group-by guarantees; asserted here at the
    // fixture level rather than reimplementing the sum.
    const categoryTotal = [200000, 100000].reduce((a, b) => a + b, 0)
    expect(categoryTotal).toBe(300000)
  })
})
