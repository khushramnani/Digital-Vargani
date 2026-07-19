import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Ledger } from '../src/lib/reconcile'
import { strings } from '../src/lib/strings'
import { MasterLedgerScreen } from '../src/features/ledger/MasterLedger'

// Component test of the screen's rendering (same pattern as
// ExpensesScreen.test.tsx): mock the db modules, not the raw Supabase client.
// booksBalanceCheck/totalCollected/volunteerCashInHand/etc. are the real
// lib/reconcile.ts functions (exhaustively unit-tested in reconcile.test.ts) —
// only the fetches are mocked. The treasurer console renders its own frame
// (dark rail + sign-out), so no AppShell/useAuth mock is needed anymore.
const { fetchFullLedger, fetchActiveVolunteers, getExpenses } = vi.hoisted(() => ({
  fetchFullLedger: vi.fn(),
  fetchActiveVolunteers: vi.fn(),
  getExpenses: vi.fn(),
}))

vi.mock('../src/lib/db/ledger', () => ({ fetchFullLedger, fetchActiveVolunteers }))
vi.mock('../src/lib/db/expenses', () => ({ getExpenses }))

const t = strings.ledger

const balancedLedger: Ledger = {
  users: [{ id: 'v-1', role: 'volunteer' }],
  donations: [{ amountPaise: 100000, mode: 'cash', collectedBy: 'v-1', voided: false }],
  expenses: [],
  handovers: [{ amountPaise: 100000, volunteerId: 'v-1', receivedBy: 'admin-1', voided: false }],
  bankOpeningPaise: 0,
}

// A genuine imbalance the banner must still catch: a handover recorded as
// coming FROM an admin. The identity assumes every handover is volunteer ->
// admin (see lib/reconcile.ts's proof comment); an admin-sourced handover is
// added to the treasurer's cash but subtracted from no volunteer, so LHS
// exceeds RHS.
const unbalancedLedger: Ledger = {
  users: [{ id: 'admin-1', role: 'admin' }],
  donations: [],
  expenses: [],
  handovers: [{ amountPaise: 100000, volunteerId: 'admin-1', receivedBy: 'admin-1', voided: false }],
  bankOpeningPaise: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults; individual tests override the ledger.
  fetchActiveVolunteers.mockResolvedValue([])
  getExpenses.mockResolvedValue([])
})

function renderScreen() {
  return render(
    <MemoryRouter>
      <MasterLedgerScreen />
    </MemoryRouter>,
  )
}

describe('MasterLedgerScreen', () => {
  it('shows the styled stat trio and a green balanced equation banner when the books-balance identity holds', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    fetchActiveVolunteers.mockResolvedValue([{ id: 'v-1', name: 'Volunteer One' }])
    renderScreen()

    // Banner: title + the equation with real reconcile numbers. Net Balance and
    // Treasurer cash are both ₹1,000.00 here (all the cash sits with the
    // treasurer after the handover); Volunteers and Bank are ₹0.00.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t.booksBalanceTitle))
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Net Balance ₹1,000.00')
    expect(banner).toHaveTextContent('Treasurer cash ₹1,000.00')

    // Stat trio: fund pool + donation count, and the net-balance card.
    expect(screen.getByText(t.fundPoolLabel)).toBeInTheDocument()
    expect(screen.getByText(`1${t.donationsCountSuffix}`)).toBeInTheDocument()
    expect(screen.getByText(t.netBalanceSubtitle)).toBeInTheDocument()

    // Cash-in-hand tracker row for the active volunteer.
    expect(screen.getByText('Volunteer One')).toBeInTheDocument()
    expect(screen.getByText(/collected ₹1,000.00 · handed ₹1,000.00/)).toBeInTheDocument()
  })

  it('shows a red equation banner with the discrepancy amount when the identity does not hold', async () => {
    fetchFullLedger.mockResolvedValue(unbalancedLedger)
    renderScreen()

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t.booksImbalanceTitle))
    expect(screen.getByRole('status')).toHaveTextContent(`${t.discrepancyPrefix}₹1,000.00`)
  })

  it('links to the volunteer collection form so an admin can log a donation as themselves', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    renderScreen()

    // The nav renders twice — dark rail (desktop) + card grid (phone) — so
    // match all copies; every one must point at /collect.
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Collect donation/ }).length).toBeGreaterThan(0))
    for (const link of screen.getAllByRole('link', { name: /Collect donation/ })) {
      expect(link).toHaveAttribute('href', '/collect')
    }
  })

  it('links to the admin management screen', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    renderScreen()

    await waitFor(() => expect(screen.getAllByRole('link', { name: /Manage admins/ }).length).toBeGreaterThan(0))
    for (const link of screen.getAllByRole('link', { name: /Manage admins/ })) {
      expect(link).toHaveAttribute('href', '/admin/admins')
    }
  })
})
