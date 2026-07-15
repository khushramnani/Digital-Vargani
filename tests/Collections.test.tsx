import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { Tables } from '../src/lib/db/database.types'
import { CollectionsScreen } from '../src/features/collection/Collections'

// Per the established pattern (ExpensesScreen.test.tsx): mock
// lib/db/donations.ts and lib/db/void.ts directly, not the raw Supabase
// client.
const { getDonations } = vi.hoisted(() => ({ getDonations: vi.fn() }))

vi.mock('../src/lib/db/donations', () => ({ getDonations }))

const { voidRow } = vi.hoisted(() => ({ voidRow: vi.fn() }))

vi.mock('../src/lib/db/void', () => ({ voidRow }))

const volunteer: Tables<'users'> = {
  id: 'volunteer-1',
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
  it('renders every donation, including a voided one struck-through with its reason and no Void button', async () => {
    render(<CollectionsScreen />)

    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())
    expect(screen.getByText('₹500')).toBeInTheDocument()
    expect(screen.getByText('Duplicate Entry')).toBeInTheDocument()
    expect(screen.getByText(/Entered twice/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Void' })).toHaveLength(1)
  })

  it('prompts for a required reason and calls voidRow(donations, ...) when Void is tapped', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Wrong amount')
    render(<CollectionsScreen />)
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Void' }))

    expect(promptSpy).toHaveBeenCalled()
    await waitFor(() =>
      expect(voidRow).toHaveBeenCalledWith('donations', 'donation-1', 'Wrong amount', 'volunteer-1'),
    )
  })

  it('does not call voidRow when the reason prompt is cancelled', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    render(<CollectionsScreen />)
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Void' }))

    expect(voidRow).not.toHaveBeenCalled()
  })
})
