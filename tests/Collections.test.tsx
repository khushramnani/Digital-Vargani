import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Tables } from '../src/lib/db/database.types'
import { CollectionsScreen } from '../src/features/collection/Collections'

// Per the established pattern (ExpensesScreen.test.tsx): mock
// lib/db/donations.ts and lib/db/void.ts directly, not the raw Supabase
// client.
const { getDonations } = vi.hoisted(() => ({ getDonations: vi.fn() }))

vi.mock('../src/lib/db/donations', () => ({ getDonations }))

const { voidRow, clearAllDonations } = vi.hoisted(() => ({ voidRow: vi.fn(), clearAllDonations: vi.fn() }))

vi.mock('../src/lib/db/void', () => ({ voidRow, clearAllDonations }))

const volunteer: Tables<'users'> = {
  id: 'volunteer-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  name: 'Sita Volunteer',
  phone: null,
  email: null,
  role: 'volunteer',
  invite_token: null,
  auth_user_id: 'auth-uid-volunteer',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
}

vi.mock('../src/features/auth/useAuth', () => ({
  useAuth: () => ({
    session: { user: { id: 'auth-uid-volunteer' } },
    appUser: volunteer,
    loading: false,
    refreshAppUser: vi.fn(),
  }),
}))

const activeDonation: Tables<'donations'> = {
  id: 'donation-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  receipt_no: 7,
  public_token: 'tok-1',
  donor_name: 'Ganesh Donor',
  donor_phone: '9000000009',
  amount_paise: 50000,
  mode: 'cash',
  collected_by: 'volunteer-1',
  created_at: '2026-01-02T00:00:00Z',
  voided: false,
  void_reason: null,
  voided_by: null,
  voided_at: null,
  sms_sent_at: null,
  client_idempotency_key: null,
}

const voidedDonation: Tables<'donations'> = {
  ...activeDonation,
  id: 'donation-2',
  receipt_no: 8,
  donor_name: 'Duplicate Entry',
  amount_paise: 90000,
  voided: true,
  void_reason: 'Entered twice',
  voided_by: 'admin-1',
  voided_at: '2026-01-03T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  getDonations.mockResolvedValue([activeDonation, voidedDonation])
  voidRow.mockResolvedValue(undefined)
})

describe('CollectionsScreen', () => {
  it('shows active donations with a Delete action and hides removed ones until toggled', async () => {
    render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())
    expect(screen.getByText('₹500.00')).toBeInTheDocument()
    // A voided donation is removed from the current ledger — hidden by default.
    expect(screen.queryByText('Duplicate Entry')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)

    // Reveal removed rows: struck-through with the reason, and no Delete action.
    fireEvent.click(screen.getByRole('button', { name: /Show removed/ }))
    expect(screen.getByText('Duplicate Entry')).toBeInTheDocument()
    expect(screen.getByText(/Entered twice/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)
  })

  it('deletes a donation through the confirm dialog, calling voidRow with the typed reason', async () => {
    render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Wrong amount' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete donation' }))

    await waitFor(() =>
      expect(voidRow).toHaveBeenCalledWith('donations', 'donation-1', 'Wrong amount'),
    )
  })

  it('does not call voidRow when the confirm dialog is cancelled', async () => {
    render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    expect(voidRow).not.toHaveBeenCalled()
  })
})
