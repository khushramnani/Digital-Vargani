import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Tables } from '../src/lib/db/database.types'
import { CollectionForm } from '../src/features/collection/CollectionForm'

// Per the brief: mock src/lib/db/donations.ts directly (not the raw
// Supabase client) — this is a component test of the form's behavior, and
// mock useAuth so appUser is a fixed, non-editable session identity, the
// same way every prior screen's tests mock only what the component itself
// calls. Task 8 adds markSmsSent (send.ts's markSmsSent is re-exported from
// this module) since CollectionForm now fires the SMS-send flow on submit.
// Task 10: CollectionForm no longer calls createDonation directly — it goes
// through the offline queue (enqueueDonation/syncOutboxItem from
// src/lib/queue/sync), which is mocked here instead so this test doesn't
// need real IndexedDB (jsdom doesn't implement it).
const { markSmsSent } = vi.hoisted(() => ({
  markSmsSent: vi.fn(),
}))

vi.mock('../src/lib/db/donations', () => ({
  markSmsSent,
}))

const { enqueueDonation, syncOutboxItem } = vi.hoisted(() => ({
  enqueueDonation: vi.fn(),
  syncOutboxItem: vi.fn(),
}))

vi.mock('../src/lib/queue/sync', () => ({
  enqueueDonation,
  syncOutboxItem,
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
  sms_sent_at: null,
  client_idempotency_key: null,
}

function renderForm() {
  render(
    <MemoryRouter>
      <CollectionForm />
    </MemoryRouter>,
  )
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Donor Name'), { target: { value: 'Ramesh Kulkarni' } })
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9876543210' } })
  fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '501' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
}

// window.location.href can't actually be assigned in jsdom without either
// throwing ("Not implemented: navigation") or leaving the test process on a
// different page — replace it with a plain writable stand-in so
// send.ts's `window.location.href = buildSmsLink(...)` is just a normal
// property write we can assert against, same idea as mocking any other
// browser API a unit under test calls but doesn't own.
const realLocation = window.location

beforeEach(() => {
  vi.clearAllMocks()
  enqueueDonation.mockResolvedValue({ localId: 'local-id-1' })
  syncOutboxItem.mockResolvedValue(createdDonation)
  markSmsSent.mockResolvedValue(undefined)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://vinayak-mandal.example', href: 'https://vinayak-mandal.example/volunteer' },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('CollectionForm', () => {
  it('blocks submission and shows inline errors when the form is empty', () => {
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(4)
    expect(enqueueDonation).not.toHaveBeenCalled()
  })

  it('converts rupees to paise and sends collectedBy from the session, never receipt_no/public_token', async () => {
    renderForm()
    fillValidForm()

    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    await waitFor(() => expect(enqueueDonation).toHaveBeenCalledTimes(1))
    const payload = enqueueDonation.mock.calls[0][0]
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

  it('immediately attempts a sync after enqueueing, using the returned localId', async () => {
    renderForm()
    fillValidForm()

    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    await waitFor(() => expect(syncOutboxItem).toHaveBeenCalledWith('local-id-1'))
  })

  it('shows the returned receipt number and resets the form after a successful submit', async () => {
    renderForm()
    fillValidForm()

    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    await waitFor(() => expect(screen.getByText(/Receipt #42/)).toBeInTheDocument())
    expect(screen.getByLabelText('Donor Name')).toHaveValue('')
    expect(screen.getByLabelText('Phone')).toHaveValue('')
    expect(screen.getByLabelText('Amount (₹)')).toHaveValue(null)
  })

  it('shows an error instead of a success confirmation when enqueueDonation rejects', async () => {
    enqueueDonation.mockRejectedValue(new Error('network error'))
    renderForm()
    fillValidForm()

    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('network error'))
    expect(screen.queryByText(/Receipt #/)).not.toBeInTheDocument()
  })

  it('shows a "saved offline" confirmation (no receipt number, no SMS attempt) when syncOutboxItem returns null, and still resets the form', async () => {
    syncOutboxItem.mockResolvedValue(null)
    renderForm()
    fillValidForm()

    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    await waitFor(() =>
      expect(screen.getByText("Saved — will send once you're back online.")).toBeInTheDocument(),
    )
    expect(screen.queryByText(/Receipt #/)).not.toBeInTheDocument()
    expect(markSmsSent).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Donor Name')).toHaveValue('')
    expect(screen.getByLabelText('Phone')).toHaveValue('')
    expect(screen.getByLabelText('Amount (₹)')).toHaveValue(null)
  })

  it('auto-attempts the SMS composer with the correct phone/message/receipt link right after a successful submit', async () => {
    renderForm()
    fillValidForm()

    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    await waitFor(() => expect(enqueueDonation).toHaveBeenCalledTimes(1))
    // jsdom's default UA isn't an iOS one, so this exercises the Android/
    // default `?body=` branch of buildSmsLink.
    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/tok-abc',
    )
    expect(window.location.href).toBe(`sms:9876543210?body=${expectedMessage}`)
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
  })

  it('always renders a fallback "Send via SMS" button after submit, which re-fires the same SMS link when tapped', async () => {
    renderForm()
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))
    await waitFor(() => expect(enqueueDonation).toHaveBeenCalledTimes(1))

    // Simulate the auto-redirect having been blocked (some browsers refuse
    // non-http navigation after an `await`) by resetting href, then tap the
    // always-visible fallback button and confirm it fires the identical link.
    window.location.href = 'https://vinayak-mandal.example/volunteer'
    markSmsSent.mockClear()

    const sendButton = screen.getByRole('button', { name: 'Send via SMS' })
    fireEvent.click(sendButton)

    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/tok-abc',
    )
    expect(window.location.href).toBe(`sms:9876543210?body=${expectedMessage}`)
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
  })

  it('renders a "Send via WhatsApp" button after submit, which opens the wa.me link when tapped', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderForm()
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))
    await waitFor(() => expect(enqueueDonation).toHaveBeenCalledTimes(1))
    markSmsSent.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))

    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/tok-abc',
    )
    expect(openSpy).toHaveBeenCalledWith(`https://wa.me/919876543210?text=${expectedMessage}`, '_blank')
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
    openSpy.mockRestore()
  })

  it('links to the Pending Send tray', () => {
    renderForm()
    expect(screen.getByRole('link', { name: 'Pending sends' })).toHaveAttribute('href', '/volunteer/pending')
  })
})
