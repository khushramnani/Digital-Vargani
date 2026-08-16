import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Ledger } from '../src/lib/reconcile'
import { strings } from '../src/lib/strings'
import { formatLocalDay } from '../src/lib/dayFilter'
import { MasterLedgerContent } from '../src/features/ledger/MasterLedger'

// Component test of the dashboard BODY (same pattern as ExpensesScreen.test.tsx):
// mock the db modules, not the raw Supabase client.
// booksBalanceCheck/totalCollected/volunteerCashInHand/etc. are the real
// lib/reconcile.ts functions (exhaustively unit-tested in reconcile.test.ts) —
// only the fetches are mocked. The console frame + its nav now live in
// AdminLayout (tests/AdminLayout.test.tsx); this file asserts the body only.
const { fetchFullLedger, fetchActiveVolunteers, getExpenses, getDonationsLite, fetchMandalUserNames } = vi.hoisted(
  () => ({
    fetchFullLedger: vi.fn(),
    fetchActiveVolunteers: vi.fn(),
    getExpenses: vi.fn(),
    getDonationsLite: vi.fn(),
    fetchMandalUserNames: vi.fn(),
  }),
)

vi.mock('../src/lib/db/ledger', () => ({ fetchFullLedger, fetchActiveVolunteers }))
vi.mock('../src/lib/db/expenses', () => ({ getExpenses }))
vi.mock('../src/lib/db/donations', () => ({ getDonationsLite }))
vi.mock('../src/lib/db/users', () => ({ fetchMandalUserNames }))

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

// v4 §2: getDonationsLite feeds the "where money came from" + "collections
// insight" cards (and now the day views). Three non-voided donations across all
// three categories; Asha's two rows (same phone) are one unique donor, Ravi (no
// phone) is a second. Timestamps are built from LOCAL clock times so the
// day-card assertions below hold in any timezone.
const jan10 = new Date(2026, 0, 10, 10, 0).toISOString()
const dashboardDonations = [
  { id: 'd1', amount_paise: 50000, category: 'society', donor_name: 'Asha', donor_phone: '+919876500001', voided: false, created_at: jan10, mode: 'cash', collected_by: 'v-1', receipt_no: 1 },
  { id: 'd2', amount_paise: 150000, category: 'shop', donor_name: 'Ravi Shop', donor_phone: null, voided: false, created_at: new Date(2026, 1, 10, 10, 0).toISOString(), mode: 'upi', collected_by: 'v-1', receipt_no: 2 },
  { id: 'd3', amount_paise: 20000, category: 'other', donor_name: 'Asha', donor_phone: '+919876500001', voided: false, created_at: new Date(2026, 2, 10, 10, 0).toISOString(), mode: 'cash', collected_by: 'v-1', receipt_no: 3 },
]

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults; individual tests override the ledger.
  fetchActiveVolunteers.mockResolvedValue([])
  getExpenses.mockResolvedValue([])
  getDonationsLite.mockResolvedValue([])
  fetchMandalUserNames.mockResolvedValue({})
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
    getDonationsLite.mockResolvedValue(dashboardDonations)
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
    getDonationsLite.mockResolvedValue([])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.whereMoneyCameFromTitle)).toBeInTheDocument())
    expect(screen.getAllByText(t.noDonationsYet)).toHaveLength(2)
  })

  // Plan 2026-08-16 §2a: the always-visible "today's collection" tile — today's
  // NON-VOIDED sum only. One live donation today, one voided today (must not
  // count), one yesterday (wrong day).
  it("shows today's non-voided collection in the stat tile", async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    const now = new Date().toISOString()
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    getDonationsLite.mockResolvedValue([
      { ...dashboardDonations[0], id: 't1', amount_paise: 30000, created_at: now },
      { ...dashboardDonations[0], id: 't2', amount_paise: 99900, created_at: now, voided: true },
      { ...dashboardDonations[0], id: 't3', amount_paise: 50000, created_at: yesterday },
    ])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.todaysCollectionLabel)).toBeInTheDocument())
    const tile = within(screen.getByText(t.todaysCollectionLabel).parentElement!)
    expect(tile.getByText('₹300.00')).toBeInTheDocument()
    expect(tile.getByText(`1${t.donationsCountSuffix}`)).toBeInTheDocument()
  })

  // Plan 2026-08-16 §2b: the "collection by day" card — defaults to today,
  // recomputes on a date change (no refetch), splits by mode and by collector,
  // ignores voided rows, and shows the empty-day copy for a day with nothing.
  it('lets the treasurer pick a day and see that day’s total, mode split and per-volunteer take', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    fetchMandalUserNames.mockResolvedValue({ 'v-1': 'Volunteer One', 'v-2': 'Volunteer Two' })
    getDonationsLite.mockResolvedValue([
      ...dashboardDonations,
      // Same day as d1, different collector, UPI — and a voided row that must not count.
      { ...dashboardDonations[0], id: 'd4', amount_paise: 25000, mode: 'upi', collected_by: 'v-2', created_at: jan10 },
      { ...dashboardDonations[0], id: 'd5', amount_paise: 77700, collected_by: 'v-2', created_at: jan10, voided: true },
    ])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.dayCardTitle)).toBeInTheDocument())
    const dayCard = within(screen.getByText(t.dayCardTitle).parentElement!)
    // Defaults to today — the fixture has nothing today.
    expect(dayCard.getByRole('button', { name: t.dayToday })).toHaveAttribute('aria-pressed', 'true')
    expect(dayCard.getByText(t.noCollectionsOnDay)).toBeInTheDocument()

    // Pick 10 Jan 2026 (local): ₹500 cash by v-1 + ₹250 upi by v-2 = ₹750, 2 donations.
    fireEvent.change(dayCard.getByLabelText(t.dayPickLabel), { target: { value: '2026-01-10' } })
    expect(dayCard.getByText('₹750.00')).toBeInTheDocument()
    expect(dayCard.getByText(`2${t.donationsCountSuffix}`)).toBeInTheDocument()
    // Mode split: cash ₹500, upi ₹250, bank ₹0 (each amount also appears once
    // in the matching volunteer's row below).
    expect(dayCard.getAllByText('₹500.00')).toHaveLength(2)
    expect(dayCard.getAllByText('₹250.00')).toHaveLength(2)
    expect(dayCard.getByText('₹0.00')).toBeInTheDocument()
    // Per-volunteer breakdown, largest first, names resolved through the id map.
    const volunteerRows = dayCard.getAllByRole('listitem').filter((li) => /Volunteer/.test(li.textContent ?? ''))
    expect(volunteerRows.map((li) => li.textContent)).toEqual(['Volunteer One₹500.00', 'Volunteer Two₹250.00'])
    expect(dayCard.getByRole('button', { name: t.dayToday })).toHaveAttribute('aria-pressed', 'false')

    // A day with nothing → empty copy, no figures.
    fireEvent.change(dayCard.getByLabelText(t.dayPickLabel), { target: { value: '2026-01-11' } })
    expect(dayCard.getByText(t.noCollectionsOnDay)).toBeInTheDocument()
    expect(dayCard.queryByText('₹750.00')).not.toBeInTheDocument()

    // The Yesterday chip just sets the input (the input stays the source of truth).
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    fireEvent.click(dayCard.getByRole('button', { name: t.dayYesterday }))
    expect(dayCard.getByLabelText(t.dayPickLabel)).toHaveValue(formatLocalDay(yesterday))
    expect(dayCard.getByRole('button', { name: t.dayYesterday })).toHaveAttribute('aria-pressed', 'true')
  })

  it('labels an unknown collector on the day card instead of dropping the row', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    fetchMandalUserNames.mockResolvedValue({})
    getDonationsLite.mockResolvedValue([{ ...dashboardDonations[0], collected_by: 'gone-user' }])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.dayCardTitle)).toBeInTheDocument())
    const dayCard = within(screen.getByText(t.dayCardTitle).parentElement!)
    fireEvent.change(dayCard.getByLabelText(t.dayPickLabel), { target: { value: '2026-01-10' } })
    expect(dayCard.getByText(strings.collections.unknownCollector)).toBeInTheDocument()
  })
})
