import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Tables } from '../src/lib/db/database.types'
import { PendingSend } from '../src/features/collection/PendingSend'

// Same mocking shape as tests/CollectionForm.test.tsx: mock
// src/lib/db/donations.ts directly (not the raw Supabase client), and mock
// useAuth so appUser is a fixed session identity. markSmsSent is mocked
// here too since send.ts's sendReceiptSms (which PendingSend reuses,
// unmocked) calls straight through to it.
const { getPendingSendDonations, markSmsSent } = vi.hoisted(() => ({
  getPendingSendDonations: vi.fn(),
  markSmsSent: vi.fn(),
}))

vi.mock('../src/lib/db/donations', () => ({
  getPendingSendDonations,
  markSmsSent,
}))

const volunteer: Tables<'users'> = {
  id: 'volunteer-1',
  name: 'Sita Volunteer',
  phone: null,
  email: null,
  role: 'volunteer',
  invite_token: null,
  auth_user_id: 'auth-uid-1',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
}

vi.mock('../src/features/auth/useAuth', () => ({
  useAuth: () => ({
    session: { user: { id: 'auth-uid-1' } },
    appUser: volunteer,
    loading: false,
    refreshAppUser: vi.fn(),
  }),
}))

const pendingDonation: Tables<'donations'> = {
  id: 'donation-1',
  receipt_no: 42,
  public_token: 'tok-abc',
  donor_name: 'Ramesh Kulkarni',
  donor_phone: '9876543210',
  amount_paise: 50100,
  mode: 'cash',
  collected_by: 'volunteer-1',
  created_at: '2026-01-01T00:00:00Z',
  voided: false,
  void_reason: null,
  voided_by: null,
  voided_at: null,
  sms_sent_at: null,
}

const realLocation = window.location

beforeEach(() => {
  vi.clearAllMocks()
  getPendingSendDonations.mockResolvedValue([pendingDonation])
  markSmsSent.mockResolvedValue(undefined)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://vinayak-mandal.example', href: 'https://vinayak-mandal.example/volunteer/pending' },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

function renderPendingSend() {
  render(
    <MemoryRouter>
      <PendingSend />
    </MemoryRouter>,
  )
}

describe('PendingSend', () => {
  it("queries the current volunteer's own pending-send donations", async () => {
    renderPendingSend()
    await waitFor(() => expect(getPendingSendDonations).toHaveBeenCalledWith('volunteer-1'))
  })

  it('renders each pending row with donor name and formatted amount', async () => {
    renderPendingSend()
    await waitFor(() => expect(screen.getByText('Ramesh Kulkarni')).toBeInTheDocument())
    expect(screen.getByText('₹501')).toBeInTheDocument()
  })

  it('shows an empty state when there are no pending donations', async () => {
    getPendingSendDonations.mockResolvedValue([])
    renderPendingSend()
    await waitFor(() => expect(screen.getByText('No pending receipts to send.')).toBeInTheDocument())
  })

  it('tapping Send fires the same SMS link flow and marks the donation sent', async () => {
    renderPendingSend()
    await waitFor(() => expect(screen.getByText('Ramesh Kulkarni')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/tok-abc',
    )
    expect(window.location.href).toBe(`sms:9876543210?body=${expectedMessage}`)
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
  })

  it('has a back link to the collection form', async () => {
    renderPendingSend()
    await waitFor(() => expect(screen.getByText('Ramesh Kulkarni')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Back to collection' })).toHaveAttribute('href', '/volunteer')
  })
})
