import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { Tables } from '../src/lib/db/database.types'
import { CollectionForm } from '../src/features/collection/CollectionForm'

// Per the brief: mock src/lib/db/donations.ts directly (not the raw
// Supabase client) — this is a component test of the form's behavior, and
// mock useAuth so appUser is a fixed, non-editable session identity, the
// same way every prior screen's tests mock only what the component itself
// calls.
const { createDonation } = vi.hoisted(() => ({
  createDonation: vi.fn(),
}))

vi.mock('../src/lib/db/donations', () => ({
  createDonation,
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

const createdDonation: Tables<'donations'> = {
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
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Donor Name'), { target: { value: 'Ramesh Kulkarni' } })
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9876543210' } })
  fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '501' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  createDonation.mockResolvedValue(createdDonation)
})

describe('CollectionForm', () => {
  it('blocks submission and shows inline errors when the form is empty', () => {
    render(<CollectionForm />)

    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(4)
    expect(createDonation).not.toHaveBeenCalled()
  })

  it('converts rupees to paise and sends collectedBy from the session, never receipt_no/public_token', async () => {
    render(<CollectionForm />)
    fillValidForm()

    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    await waitFor(() => expect(createDonation).toHaveBeenCalledTimes(1))
    const payload = createDonation.mock.calls[0][0]
    expect(payload).toEqual({
      donorName: 'Ramesh Kulkarni',
      donorPhone: '9876543210',
      amountPaise: 50100,
      mode: 'cash',
      collectedBy: 'volunteer-1',
    })
    expect(payload).not.toHaveProperty('receipt_no')
    expect(payload).not.toHaveProperty('public_token')
  })

  it('shows the returned receipt number and resets the form after a successful submit', async () => {
    render(<CollectionForm />)
    fillValidForm()

    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    await waitFor(() => expect(screen.getByText(/Receipt #42/)).toBeInTheDocument())
    expect(screen.getByLabelText('Donor Name')).toHaveValue('')
    expect(screen.getByLabelText('Phone')).toHaveValue('')
    expect(screen.getByLabelText('Amount (₹)')).toHaveValue(null)
  })

  it('shows an error instead of a success confirmation when createDonation rejects', async () => {
    createDonation.mockRejectedValue(new Error('network error'))
    render(<CollectionForm />)
    fillValidForm()

    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('network error'))
    expect(screen.queryByText(/Receipt #/)).not.toBeInTheDocument()
  })
})
