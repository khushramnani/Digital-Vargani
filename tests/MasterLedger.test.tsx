import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Ledger } from '../src/lib/reconcile'
import { MasterLedgerScreen } from '../src/features/ledger/MasterLedger'

// Mock lib/db/ledger.ts directly (not the raw Supabase client) — this is a
// component test of the screen's rendering, same pattern as
// ExpensesScreen.test.tsx. booksBalanceCheck/totalCollected/etc. are the
// real lib/reconcile.ts functions (already exhaustively unit-tested in
// reconcile.test.ts) — only the fetch is mocked.
const { fetchFullLedger } = vi.hoisted(() => ({ fetchFullLedger: vi.fn() }))

vi.mock('../src/lib/db/ledger', () => ({ fetchFullLedger }))

const balancedLedger: Ledger = {
  users: [{ id: 'v-1', role: 'volunteer' }],
  donations: [{ amountPaise: 100000, mode: 'cash', collectedBy: 'v-1', voided: false }],
  expenses: [],
  handovers: [{ amountPaise: 100000, volunteerId: 'v-1', receivedBy: 'admin-1', voided: false }],
  bankOpeningPaise: 0,
}

// Same imbalance reconcile.test.ts proves: a cash donation collected by an
// admin breaks the "cash always collected by a volunteer" modeling
// assumption the identity depends on (see lib/reconcile.ts's proof
// comment) — it inflates totalCollected without landing in any
// volunteer's cash-in-hand or in cashHeldByTreasurer.
const unbalancedLedger: Ledger = {
  users: [{ id: 'admin-1', role: 'admin' }],
  donations: [{ amountPaise: 100000, mode: 'cash', collectedBy: 'admin-1', voided: false }],
  expenses: [],
  handovers: [],
  bankOpeningPaise: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
})

function renderScreen() {
  return render(
    <MemoryRouter>
      <MasterLedgerScreen />
    </MemoryRouter>,
  )
}

describe('MasterLedgerScreen', () => {
  it('shows totals and a green balanced indicator when the books-balance identity holds', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    renderScreen()

    // Total Collected and Net Balance are both ₹1,000 here (no expenses).
    await waitFor(() => expect(screen.getAllByText('₹1,000')).toHaveLength(2))
    expect(screen.getByRole('status')).toHaveTextContent('Books balanced')
  })

  it('shows a red indicator with the discrepancy amount when the identity does not hold', async () => {
    fetchFullLedger.mockResolvedValue(unbalancedLedger)
    renderScreen()

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Discrepancy: ₹-1,000')
  })
})
