import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Ledger } from '../src/lib/reconcile'
import { strings } from '../src/lib/strings'
import { MasterLedgerContent } from '../src/features/ledger/MasterLedger'

// Component test of the dashboard BODY (same pattern as ExpensesScreen.test.tsx):
// mock the db modules, not the raw Supabase client.
// booksBalanceCheck/totalCollected/volunteerCashInHand/etc. are the real
// lib/reconcile.ts functions (exhaustively unit-tested in reconcile.test.ts) —
// only the fetches are mocked. The console frame + its nav now live in
// AdminLayout (tests/AdminLayout.test.tsx); this file asserts the body only.
const { fetchFullLedger, fetchActiveVolunteers, getExpenses, getDonations } = vi.hoisted(() => ({
  fetchFullLedger: vi.fn(),
  fetchActiveVolunteers: vi.fn(),
  getExpenses: vi.fn(),
  getDonations: vi.fn(),
}))

vi.mock('../src/lib/db/ledger', () => ({ fetchFullLedger, fetchActiveVolunteers }))
vi.mock('../src/lib/db/expenses', () => ({ getExpenses }))
vi.mock('../src/lib/db/donations', () => ({ getDonations }))

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

// v4 §2: getDonations feeds the "where money came from" + "collections insight"
// cards. Three non-voided donations across all three categories; Asha's two rows
// (same phone) are one unique donor, Ravi (no phone) is a second.
const dashboardDonations = [
  { id: 'd1', amount_paise: 50000, category: 'society', donor_name: 'Asha', donor_phone: '+919876500001', voided: false, created_at: '2026-01-10T10:00:00Z', mode: 'cash', collected_by: 'v-1', receipt_no: 1 },
  { id: 'd2', amount_paise: 150000, category: 'shop', donor_name: 'Ravi Shop', donor_phone: null, voided: false, created_at: '2026-02-10T10:00:00Z', mode: 'upi', collected_by: 'v-1', receipt_no: 2 },
  { id: 'd3', amount_paise: 20000, category: 'other', donor_name: 'Asha', donor_phone: '+919876500001', voided: false, created_at: '2026-03-10T10:00:00Z', mode: 'cash', collected_by: 'v-1', receipt_no: 3 },
]

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults; individual tests override the ledger.
  fetchActiveVolunteers.mockResolvedValue([])
  getExpenses.mockResolvedValue([])
  getDonations.mockResolvedValue([])
})

function renderScreen() {
  return render(
    <MemoryRouter>
      <MasterLedgerContent />
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

    // v3: the mobile 2×2 grid's 4th "Cash w/ volunteers" tile (present in the
    // DOM; hidden with lg:hidden on desktop). Here all cash sits with the
    // treasurer post-handover, so it reads ₹0.00.
    expect(screen.getByText(t.cashWithVolunteersLabel)).toBeInTheDocument()
  })

  it('shows a red equation banner with the discrepancy amount when the identity does not hold', async () => {
    fetchFullLedger.mockResolvedValue(unbalancedLedger)
    renderScreen()

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t.booksImbalanceTitle))
    expect(screen.getByRole('status')).toHaveTextContent(`${t.discrepancyPrefix}₹1,000.00`)
  })

  it('renders the v4 source split and collections-insight cards from the donation rows', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    getDonations.mockResolvedValue(dashboardDonations)
    renderScreen()

    // "Where the money came from": per-category label + amount (Society ₹500,
    // Shop ₹1,500, Other ₹200).
    await waitFor(() => expect(screen.getByText(t.whereMoneyCameFromTitle)).toBeInTheDocument())
    expect(screen.getByText(t.sourceSocietyLabel)).toBeInTheDocument()
    expect(screen.getByText(t.sourceShopLabel)).toBeInTheDocument()
    expect(screen.getByText(t.sourceOtherLabel)).toBeInTheDocument()
    expect(screen.getByText('₹500.00')).toBeInTheDocument()
    expect(screen.getByText('₹200.00')).toBeInTheDocument()

    // "Collections insight": total 3, unique donors 2, average ₹733.33.
    expect(screen.getByText(t.insightTitle)).toBeInTheDocument()
    expect(screen.getByText(t.insightUniqueDonors)).toBeInTheDocument()
    expect(screen.getByText('₹733.33')).toBeInTheDocument()
  })

  it('shows the empty-donations copy on both v4 cards when there are no donations', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    getDonations.mockResolvedValue([])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.whereMoneyCameFromTitle)).toBeInTheDocument())
    expect(screen.getAllByText(t.noDonationsYet)).toHaveLength(2)
  })
})
