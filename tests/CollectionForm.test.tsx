import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Tables } from '../src/lib/db/database.types'
import { CollectionForm } from '../src/features/collection/CollectionForm'

// Per the brief: mock src/lib/db/donations.ts directly (not the raw
// Supabase client) — this is a component test of the form's behavior, and
// mock useAuth so appUser is a fixed, non-editable session identity, the
// same way every prior screen's tests mock only what the component itself
// calls. markSmsSent (send.ts's markSmsSent is re-exported from this module)
// is mocked because CollectionForm reaches it through the send helpers — but
// only when a send button is tapped. Audit v3 removed the on-submit auto-fire,
// so a bare submit no longer calls it.
// Task 10: CollectionForm no longer calls createDonation directly — it goes
// through the offline queue (enqueueDonation/syncOutboxItem from
// src/lib/queue/sync), which is mocked here instead so this test doesn't
// need real IndexedDB (jsdom doesn't implement it).
const { markSmsSent, getDonations } = vi.hoisted(() => ({
  markSmsSent: vi.fn(),
  // CollectionForm now reads the volunteer's own donations to compute the
  // "₹X today · N donors" greeting chip. Default to an empty ledger.
  getDonations: vi.fn(),
}))

vi.mock('../src/lib/db/donations', () => ({
  markSmsSent,
  getDonations,
}))

const { enqueueDonation, syncOutboxItem } = vi.hoisted(() => ({
  enqueueDonation: vi.fn(),
  syncOutboxItem: vi.fn(),
}))

vi.mock('../src/lib/queue/sync', () => ({
  enqueueDonation,
  syncOutboxItem,
}))

// CollectionForm now presets the language picker from the mandal default.
// Mock it so the test never touches the real supabase client (this file
// doesn't mock ../src/lib/db/client), and so the preset is deterministic.
const { getMandalDefaultLang } = vi.hoisted(() => ({
  getMandalDefaultLang: vi.fn(),
}))

vi.mock('../src/lib/db/config', () => ({
  getMandalDefaultLang,
}))

const volunteer: Tables<'users'> = {
  id: 'volunteer-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
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
  mandal_id: '11111111-1111-1111-1111-000000000001',
  receipt_no: 42,
  public_token: 'tok-abc',
  donor_name: 'Ramesh Kulkarni',
  donor_phone: '9876543210',
  amount_paise: 50100,
  mode: 'cash',
  category: 'society',
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
  // Reset the remembered send channel so each test starts on the SMS default
  // (a WhatsApp tap in a prior test must not carry over and change auto-send).
  localStorage.clear()
  enqueueDonation.mockResolvedValue({ localId: 'local-id-1' })
  syncOutboxItem.mockResolvedValue(createdDonation)
  markSmsSent.mockResolvedValue(undefined)
  getDonations.mockResolvedValue([])
  getMandalDefaultLang.mockResolvedValue('en')
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

    // Name, amount, and mode error on an empty form; phone is optional now
    // (audit #8), so it does not.
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(3)
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
      // v4 §3: PhoneInput stores E.164 — the national digits typed into the
      // field are combined with the visible country code (default 🇮🇳 +91),
      // replacing the old silent "10 digits must be Indian" guess in send.ts.
      donorPhone: '+919876543210',
      amountPaise: 50100,
      mode: 'cash',
      // v4 §2: defaults to Society (the door-to-door case) unless re-picked.
      category: 'society',
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

  it('does NOT auto-fire on submit — it shows the send-choice card with both channels and marks nothing sent', async () => {
    renderForm()
    fillValidForm()

    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    await waitFor(() => expect(screen.getByText(/Receipt #42/)).toBeInTheDocument())
    // Nothing sends silently: the OS composer is never navigated to, and the
    // donation is not marked sent, so it stays in Pending Send.
    expect(window.location.href).toBe('https://vinayak-mandal.example/volunteer')
    expect(markSmsSent).not.toHaveBeenCalled()
    // Both channels are offered as an explicit choice.
    expect(screen.getByRole('button', { name: 'Send via SMS' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send via WhatsApp' })).toBeInTheDocument()
  })

  it('fires the SMS link and marks the donation sent only once "Send via SMS" is tapped', async () => {
    renderForm()
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send via SMS' })).toBeInTheDocument())

    // jsdom's default UA isn't an iOS one, so this exercises the Android/
    // default `?body=` branch of buildSmsLink.
    fireEvent.click(screen.getByRole('button', { name: 'Send via SMS' }))

    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/42-tok-abc?lang=en',
    )
    // v4: the stored legacy 10-digit phone is normalized to E.164 (+91…) before
    // the sms: link is built (send.ts / normalizeToE164).
    expect(window.location.href).toBe(`sms:+919876543210?body=${expectedMessage}`)
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
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/42-tok-abc?lang=en',
    )
    expect(openSpy).toHaveBeenCalledWith(`https://wa.me/919876543210?text=${expectedMessage}`, '_blank', 'noopener')
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
    openSpy.mockRestore()
  })

  it('links to the Pending Send tray', () => {
    renderForm()
    expect(screen.getByRole('link', { name: 'Pending sends' })).toHaveAttribute('href', '/collect/pending')
  })

  it('hides both send buttons and shows the no-phone hint when the donation has no donor phone', async () => {
    syncOutboxItem.mockResolvedValue({ ...createdDonation, donor_phone: null })
    renderForm()
    fireEvent.change(screen.getByLabelText('Donor Name'), { target: { value: 'No Phone Donor' } })
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '501' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    await waitFor(() => expect(screen.getByText(/Receipt #42/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Send via SMS' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send via WhatsApp' })).not.toBeInTheDocument()
    expect(screen.getByText('No phone number given — receipt cannot be sent.')).toBeInTheDocument()
    // No phone means no auto-send fired either.
    expect(markSmsSent).not.toHaveBeenCalled()
  })

  it('presets the language picker from the mandal default and sends the receipt in it', async () => {
    getMandalDefaultLang.mockResolvedValue('mr')
    renderForm()

    await waitFor(() => expect(screen.getByRole('radio', { name: 'मराठी' })).toBeChecked())

    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send via SMS' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Send via SMS' }))

    // The Marathi copy, and the link carries ?lang=mr so the receipt page
    // reads the same language straight back out.
    const expectedMessage = encodeURIComponent(
      'तुमच्या ₹501 वर्गणीबद्दल धन्यवाद. तुमची अधिकृत पावती येथे पहा: https://vinayak-mandal.example/r/42-tok-abc?lang=mr',
    )
    // v4: the stored legacy 10-digit phone is normalized to E.164 (+91…) before
    // the sms: link is built (send.ts / normalizeToE164).
    expect(window.location.href).toBe(`sms:+919876543210?body=${expectedMessage}`)
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
  })
})
