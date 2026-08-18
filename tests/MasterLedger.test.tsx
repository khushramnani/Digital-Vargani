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
// only the fetches are mocked. The console frame + its nav live in AdminLayout
// (tests/AdminLayout.test.tsx); this file asserts the body only.
const {
  fetchFullLedger,
  fetchActiveVolunteers,
  getExpenses,
  getDonationsLite,
  fetchMandalUserNames,
  getDonationSources,
} = vi.hoisted(() => ({
  fetchFullLedger: vi.fn(),
  fetchActiveVolunteers: vi.fn(),
  getExpenses: vi.fn(),
  getDonationsLite: vi.fn(),
  fetchMandalUserNames: vi.fn(),
  getDonationSources: vi.fn(),
}))

vi.mock('../src/lib/db/ledger', () => ({ fetchFullLedger, fetchActiveVolunteers }))
vi.mock('../src/lib/db/expenses', () => ({ getExpenses }))
vi.mock('../src/lib/db/donations', () => ({ getDonationsLite }))
vi.mock('../src/lib/db/users', () => ({ fetchMandalUserNames }))
vi.mock('../src/lib/db/config', () => ({ getDonationSources }))

const t = strings.ledger

const balancedLedger: Ledger = {
  users: [{ id: 'v-1', role: 'volunteer' }],
  donations: [{ amountPaise: 100000, mode: 'cash', collectedBy: 'v-1', voided: false }],
  expenses: [],
  handovers: [{ amountPaise: 100000, volunteerId: 'v-1', receivedBy: 'admin-1', voided: false }],
  bankOpeningPaise: 0,
}

// A genuine imbalance the hero chip must still catch: a handover recorded as
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

// Day fixtures are anchored to the real clock, because the day card's tile row
// only ever shows the selected month up to today — a January 2026 fixture would
// be several picker taps away and would rot as the calendar moves.
const now = new Date()
const todayKey = formatLocalDay(now)
const yesterday = new Date(now)
yesterday.setDate(yesterday.getDate() - 1)
const yesterdayKey = formatLocalDay(yesterday)

// A timestamp at local noon on a given day, so no timezone can push it over a
// day boundary.
const at = (day: Date) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0).toISOString()

const donation = (over: Partial<Record<string, unknown>> = {}) => ({
  amount_paise: 50000,
  category: 'society',
  donor_name: 'Asha',
  donor_phone: '+919876500001',
  voided: false,
  created_at: at(now),
  mode: 'cash',
  collected_by: 'v-1',
  receipt_no: 1,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults; individual tests override the ledger.
  fetchActiveVolunteers.mockResolvedValue([])
  getExpenses.mockResolvedValue([])
  getDonationsLite.mockResolvedValue([])
  fetchMandalUserNames.mockResolvedValue({})
  getDonationSources.mockResolvedValue(['Society', 'Shop', 'Other'])
})

function renderScreen() {
  return render(
    <MemoryRouter>
      <MasterLedgerContent />
    </MemoryRouter>,
  )
}

const dayCard = () => within(screen.getByText(t.dayCardTitle).closest('div')!.parentElement!)

describe('MasterLedgerContent — the Overview tab', () => {
  it('leads with the net balance, a Balanced chip, and what came in against what went out', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    fetchActiveVolunteers.mockResolvedValue([{ id: 'v-1', name: 'Volunteer One' }])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.netBalanceEyebrow)).toBeInTheDocument())
    expect(screen.getByText(t.balancedChip)).toBeInTheDocument()
    expect(screen.getByText(t.netBalanceHint)).toBeInTheDocument()
    // ₹1,000 collected, nothing spent, so the net is the whole ₹1,000.
    expect(screen.getAllByText(/^₹1,000/).length).toBeGreaterThan(0)
    expect(screen.getByText(t.donationsUnit(1))).toBeInTheDocument()
    expect(screen.getByText(t.paymentsUnit(0))).toBeInTheDocument()
    // Nothing spent yet, so the spent column reads 0%.
    expect(screen.getByText(t.spentEyebrowPct('0%'))).toBeInTheDocument()
  })

  it('replaces the Balanced chip with the signed discrepancy when the identity does not hold', async () => {
    fetchFullLedger.mockResolvedValue(unbalancedLedger)
    renderScreen()

    await waitFor(() => expect(screen.getByText(`${t.offByPrefix}₹1,000.00`)).toBeInTheDocument())
    expect(screen.queryByText(t.balancedChip)).not.toBeInTheDocument()
  })

  it('explains the arithmetic behind the hero in a sheet, not as a printed equation', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    renderScreen()
    await waitFor(() => expect(screen.getByText(t.netBalanceEyebrow)).toBeInTheDocument())

    // Nothing of the explanation is on screen until asked for.
    expect(screen.queryByText(t.reconHoldTitle)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t.reconSheetTitle }))

    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByRole('heading', { name: t.reconSheetTitle })).toBeInTheDocument()
    // The three buckets we hold, and the books' own figure — the identity
    // booksBalanceCheck enforces, in words.
    expect(sheet.getByText(t.reconHoldTitle)).toBeInTheDocument()
    expect(sheet.getByText(t.cashWithVolunteersTitle)).toBeInTheDocument()
    expect(sheet.getByText(t.reconTreasurerLabel)).toBeInTheDocument()
    expect(sheet.getByText(t.equationBank)).toBeInTheDocument()
    expect(sheet.getByText(t.reconTotalHeld)).toBeInTheDocument()
    expect(sheet.getByText(t.reconOkLine)).toBeInTheDocument()
    expect(sheet.getByText(t.reconVoidNote)).toBeInTheDocument()
  })

  it('names the off-by amount in the sheet too when the books disagree', async () => {
    fetchFullLedger.mockResolvedValue(unbalancedLedger)
    renderScreen()
    await waitFor(() => expect(screen.getByText(t.netBalanceEyebrow)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: t.reconSheetTitle }))

    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByText(t.reconBadLine)).toBeInTheDocument()
    expect(sheet.getByText(`${t.reconOffByPrefix}₹1,000.00.`)).toBeInTheDocument()
  })

  it('lists whoever still owes cash and collapses everyone settled behind one line', async () => {
    fetchFullLedger.mockResolvedValue({
      users: [
        { id: 'v-1', role: 'volunteer' },
        { id: 'v-2', role: 'volunteer' },
      ],
      donations: [
        { amountPaise: 100000, mode: 'cash', collectedBy: 'v-1', voided: false },
        { amountPaise: 20000, mode: 'cash', collectedBy: 'v-2', voided: false },
      ],
      expenses: [],
      // v-2 has handed everything in; v-1 still holds ₹1,000.
      handovers: [{ amountPaise: 20000, volunteerId: 'v-2', receivedBy: 'admin-1', voided: false }],
      bankOpeningPaise: 0,
    } satisfies Ledger)
    fetchActiveVolunteers.mockResolvedValue([
      { id: 'v-1', name: 'Owes Volunteer' },
      { id: 'v-2', name: 'Settled Volunteer' },
    ])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.cashWithVolunteersTitle)).toBeInTheDocument())
    expect(screen.getByText(t.volunteersOwing(1, 2))).toBeInTheDocument()
    // The one who owes is listed openly; a settled volunteer is not a task.
    expect(screen.getByText('Owes Volunteer')).toBeInTheDocument()
    expect(screen.queryByText('Settled Volunteer')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t.settledShow(1) }))

    expect(screen.getByText('Settled Volunteer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.settledHide })).toBeInTheDocument()
  })

  it('surfaces cash still held by a volunteer who is no longer active', async () => {
    fetchFullLedger.mockResolvedValue({
      users: [{ id: 'gone', role: 'volunteer' }],
      donations: [{ amountPaise: 40000, mode: 'cash', collectedBy: 'gone', voided: false }],
      expenses: [],
      handovers: [],
      bankOpeningPaise: 0,
    } satisfies Ledger)
    // Deactivated, so absent from the active list — but the money is still real.
    fetchActiveVolunteers.mockResolvedValue([])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.inactiveVolunteersLabel)).toBeInTheDocument())
  })

  // Plan 2026-08-16 §2b, redrawn 2026-08-18: the day card defaults to today,
  // switches on a tile tap with no refetch, splits by mode/source/volunteer, and
  // never counts a voided row.
  it("shows today's take by default, split by mode, source and volunteer", async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    fetchMandalUserNames.mockResolvedValue({ 'v-1': 'Volunteer One', 'v-2': 'Volunteer Two' })
    getDonationsLite.mockResolvedValue([
      donation({ amount_paise: 50000, mode: 'cash', collected_by: 'v-1', category: 'society' }),
      donation({ amount_paise: 25000, mode: 'upi', collected_by: 'v-2', category: 'Galli' }),
      // Voided: counts towards nothing.
      donation({ amount_paise: 77700, collected_by: 'v-2', voided: true }),
      // Yesterday: wrong day.
      donation({ amount_paise: 90000, created_at: at(yesterday) }),
    ])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.dayCardTitle)).toBeInTheDocument())
    const card = dayCard()

    // ₹500 cash + ₹250 upi = ₹750 across 2 donations.
    expect(card.getByText(t.donationsCollected(2))).toBeInTheDocument()
    expect(card.getAllByText(/^₹750/).length).toBeGreaterThan(0)
    // Today's tile is the selected one.
    expect(card.getByRole('button', { name: todayKey })).toHaveAttribute('aria-pressed', 'true')

    // Mode split names all three modes even when one is zero.
    expect(card.getByText(t.byModeTitle)).toBeInTheDocument()
    expect(card.getByText(strings.collection.modeBank)).toBeInTheDocument()
    // Source split, by label.
    expect(card.getByText(t.bySourceTitle)).toBeInTheDocument()
    expect(card.getByText('Society')).toBeInTheDocument()
    expect(card.getByText('Galli')).toBeInTheDocument()
    // Volunteer split, largest first, names resolved through the id map.
    expect(card.getByText('Volunteer One')).toBeInTheDocument()
    expect(card.getByText('Volunteer Two')).toBeInTheDocument()
  })

  it('switches day on a tile tap and says so when the day is empty', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    getDonationsLite.mockResolvedValue([donation({ amount_paise: 50000 })])
    renderScreen()
    await waitFor(() => expect(screen.getByText(t.dayCardTitle)).toBeInTheDocument())
    const card = dayCard()

    fireEvent.click(card.getByRole('button', { name: yesterdayKey }))

    expect(card.getByText(t.dayEmptyOther)).toBeInTheDocument()
    expect(card.getByText(t.dayEmptyHint)).toBeInTheDocument()
    expect(card.queryByText(t.byModeTitle)).not.toBeInTheDocument()
  })

  it('uses the today-specific empty line when today itself is empty', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    getDonationsLite.mockResolvedValue([donation({ created_at: at(yesterday) })])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.dayEmptyToday)).toBeInTheDocument())
  })

  it('labels an unknown collector instead of dropping the row', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    fetchMandalUserNames.mockResolvedValue({})
    getDonationsLite.mockResolvedValue([donation({ collected_by: 'gone-user' })])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.dayCardTitle)).toBeInTheDocument())
    expect(dayCard().getByText(strings.collections.unknownCollector)).toBeInTheDocument()
  })

  it('opens a day picker that can jump back to today', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    getDonationsLite.mockResolvedValue([donation({ created_at: at(yesterday) })])
    renderScreen()
    await waitFor(() => expect(screen.getByText(t.dayCardTitle)).toBeInTheDocument())
    const card = dayCard()

    // Move off today first, so "jump to today" has something to undo.
    fireEvent.click(card.getByRole('button', { name: yesterdayKey }))
    fireEvent.click(card.getByRole('button', { name: t.dayPickLabel }))

    const picker = within(screen.getByRole('dialog'))
    expect(picker.getByRole('heading', { name: t.pickerTitle })).toBeInTheDocument()
    fireEvent.click(picker.getByRole('button', { name: t.pickerJumpToday }))

    expect(dayCard().getByRole('button', { name: todayKey })).toHaveAttribute('aria-pressed', 'true')
  })

  it('builds "where the money came from" from the mandal list, folding legacy slugs into their names', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    getDonationSources.mockResolvedValue(['Society', 'Galli'])
    getDonationsLite.mockResolvedValue([
      donation({ amount_paise: 50000, category: 'society' }),
      donation({ amount_paise: 10000, category: 'Society' }),
      donation({ amount_paise: 150000, category: 'Galli' }),
      // A source the mandal has since removed — its rupees must stay visible.
      donation({ amount_paise: 20000, category: 'Shop' }),
    ])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.whereMoneyCameFromTitle)).toBeInTheDocument())
    const card = within(screen.getByText(t.whereMoneyCameFromTitle).parentElement!)
    // 'society' + 'Society' are one source, not two.
    expect(card.getByText('Society')).toBeInTheDocument()
    expect(card.getByText(strings.collections.donationsUnit(2))).toBeInTheDocument()
    expect(card.getByText(/^₹600/)).toBeInTheDocument()
    expect(card.getByText('Galli')).toBeInTheDocument()
    expect(card.getByText('Shop')).toBeInTheDocument()
  })

  it('counts unique donors by phone, so one donor giving twice is one donor', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    getDonationsLite.mockResolvedValue([
      donation({ amount_paise: 50000, donor_phone: '+919876500001' }),
      donation({ amount_paise: 20000, donor_phone: '9876500001' }),
      donation({ amount_paise: 150000, donor_name: 'Ravi Shop', donor_phone: null }),
    ])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.insightTitle)).toBeInTheDocument())
    const card = within(screen.getByText(t.insightTitle).parentElement!)
    // A 10-digit legacy row and its +91 twin are the same donor.
    expect(card.getByText(t.insightUniqueDonors).nextElementSibling).toHaveTextContent('2')
    expect(card.getByText(t.insightTotalDonations).nextElementSibling).toHaveTextContent('3')
    // ₹2,200 over 3 donations.
    expect(card.getByText('₹733.33')).toBeInTheDocument()
  })

  it('shows the empty-donations copy on both donation cards when there are none', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    getDonationsLite.mockResolvedValue([])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.whereMoneyCameFromTitle)).toBeInTheDocument())
    expect(screen.getAllByText(t.noDonationsYet)).toHaveLength(2)
  })
})
