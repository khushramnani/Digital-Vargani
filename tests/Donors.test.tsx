import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { strings } from '../src/lib/strings'
import { DonorsContent } from '../src/features/donors/Donors'

// Same pattern as MasterLedger.test / Collections.test: mock the db wrappers,
// not the raw Supabase client. DonorsContent reads three: the donor summary
// RPC wrapper (donors.ts), the full donation list (donations.ts, for the year
// picker + history), and the id→name map (users.ts, for "collected by").
const { getDonorsSummary, getDonations, fetchMandalUserNames } = vi.hoisted(() => ({
  getDonorsSummary: vi.fn(),
  getDonations: vi.fn(),
  fetchMandalUserNames: vi.fn(),
}))

vi.mock('../src/lib/db/donors', () => ({ getDonorsSummary }))
vi.mock('../src/lib/db/donations', () => ({ getDonations }))
vi.mock('../src/lib/db/users', () => ({ fetchMandalUserNames }))

const sd = strings.donors

const donors = [
  { donorKey: '+919876500001', donorName: 'Asha', donorPhone: '+919876500001', totalPaise: 70000, donationCount: 2, firstAt: '2026-01-10T10:00:00Z', lastAt: '2026-03-10T10:00:00Z' },
  { donorKey: 'ravi shop', donorName: 'Ravi Shop', donorPhone: '', totalPaise: 150000, donationCount: 1, firstAt: '2025-02-10T10:00:00Z', lastAt: '2025-02-10T10:00:00Z' },
]

// Spans two years so the year picker has a real choice (2026 + 2025).
const donations = [
  { id: 'd1', amount_paise: 50000, category: 'society', donor_name: 'Asha', donor_phone: '+919876500001', voided: false, created_at: '2026-01-10T10:00:00Z', mode: 'cash', collected_by: 'v-1', receipt_no: 1 },
  { id: 'd2', amount_paise: 20000, category: 'other', donor_name: 'Asha', donor_phone: '+919876500001', voided: false, created_at: '2026-03-10T10:00:00Z', mode: 'cash', collected_by: 'v-1', receipt_no: 3 },
  { id: 'd3', amount_paise: 150000, category: 'shop', donor_name: 'Ravi Shop', donor_phone: null, voided: false, created_at: '2025-02-10T10:00:00Z', mode: 'upi', collected_by: 'v-1', receipt_no: 2 },
]

beforeEach(() => {
  vi.clearAllMocks()
  getDonorsSummary.mockResolvedValue(donors)
  getDonations.mockResolvedValue(donations)
  fetchMandalUserNames.mockResolvedValue({ 'v-1': 'Volunteer One' })
})

function renderScreen() {
  return render(
    <MemoryRouter>
      <DonorsContent />
    </MemoryRouter>,
  )
}

describe('DonorsContent', () => {
  it('lists each donor with their formatINR total and donation count', async () => {
    renderScreen()

    await waitFor(() => expect(screen.getByText('Asha')).toBeInTheDocument())
    expect(screen.getByText('Ravi Shop')).toBeInTheDocument()
    expect(screen.getByText('₹700.00')).toBeInTheDocument()
    expect(screen.getByText('₹1,500.00')).toBeInTheDocument()
  })

  it('offers tel: and wa.me links for a donor who has a phone, and "no phone" otherwise', async () => {
    const { container } = renderScreen()

    await waitFor(() => expect(screen.getByText('Asha')).toBeInTheDocument())

    // Asha's phone (+919876500001) → a tel: dialer link and a wa.me digits link.
    const tel = container.querySelector('a[href^="tel:"]')
    expect(tel).toHaveAttribute('href', 'tel:+919876500001')
    const wa = container.querySelector('a[href^="https://wa.me/"]')
    expect(wa).toHaveAttribute('href', 'https://wa.me/919876500001')

    // Ravi has no phone → the noPhone copy, and only one contactable donor.
    expect(screen.getByText(sd.noPhone)).toBeInTheDocument()
    expect(container.querySelectorAll('a[href^="tel:"]')).toHaveLength(1)
  })

  it('refetches the summary for the selected year via the year filter', async () => {
    renderScreen()

    await waitFor(() => expect(screen.getByText('Asha')).toBeInTheDocument())
    // First load is the "all years" call (p_year undefined).
    expect(getDonorsSummary).toHaveBeenCalledWith(undefined)

    fireEvent.change(screen.getByLabelText(sd.yearFilterLabel), { target: { value: '2025' } })
    await waitFor(() => expect(getDonorsSummary).toHaveBeenCalledWith(2025))
  })

  it('expands a donor row to show their donation history', async () => {
    renderScreen()

    await waitFor(() => expect(screen.getByText('Asha')).toBeInTheDocument())
    // History is hidden until the row is tapped.
    expect(screen.queryByText(sd.historyTitle)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Asha'))
    expect(screen.getByText(sd.historyTitle)).toBeInTheDocument()
    // Asha's two donations, labelled with the collector's name.
    expect(screen.getAllByText(/Volunteer One/).length).toBeGreaterThan(0)
  })
})
