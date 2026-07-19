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

// Task 10: PendingSend also queries the Dexie outbox table directly
// (db.outbox.orderBy('queuedAt').toArray()) for still-queued items. Mocked
// here rather than exercising real Dexie/IndexedDB, which jsdom doesn't
// implement.
const { outboxToArray } = vi.hoisted(() => ({
  outboxToArray: vi.fn(),
}))

vi.mock('../src/lib/queue/db', () => ({
  db: {
    outbox: {
      orderBy: () => ({ toArray: outboxToArray }),
    },
  },
}))

// PendingSend presets its own language picker from the mandal default.
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

const pendingDonation: Tables<'donations'> = {
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

const realLocation = window.location

beforeEach(() => {
  vi.clearAllMocks()
  getPendingSendDonations.mockResolvedValue([pendingDonation])
  markSmsSent.mockResolvedValue(undefined)
  outboxToArray.mockResolvedValue([])
  getMandalDefaultLang.mockResolvedValue('en')
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
    expect(screen.getByText('₹501.00')).toBeInTheDocument()
  })

  it('shows an empty state when there are no pending donations', async () => {
    getPendingSendDonations.mockResolvedValue([])
    renderPendingSend()
    await waitFor(() => expect(screen.getByText('No pending receipts to send.')).toBeInTheDocument())
  })

  it('hides the send buttons and shows the no-phone hint for a phoneless pending donation', async () => {
    getPendingSendDonations.mockResolvedValue([{ ...pendingDonation, donor_phone: null }])
    renderPendingSend()
    await waitFor(() => expect(screen.getByText('Ramesh Kulkarni')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'SMS' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'WhatsApp' })).not.toBeInTheDocument()
    expect(screen.getByText('No phone number given — receipt cannot be sent.')).toBeInTheDocument()
  })

  it('tapping SMS fires the same SMS link flow and marks the donation sent', async () => {
    renderPendingSend()
    await waitFor(() => expect(screen.getByText('Ramesh Kulkarni')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'SMS' }))

    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/42-tok-abc?lang=en',
    )
    // v4: the stored legacy 10-digit phone is normalized to E.164 (+91…) before
    // the sms: link is built (send.ts / normalizeToE164).
    expect(window.location.href).toBe(`sms:+919876543210?body=${expectedMessage}`)
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
  })

  it('tapping WhatsApp opens the wa.me link and marks the donation sent', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderPendingSend()
    await waitFor(() => expect(screen.getByText('Ramesh Kulkarni')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }))

    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/42-tok-abc?lang=en',
    )
    expect(openSpy).toHaveBeenCalledWith(`https://wa.me/919876543210?text=${expectedMessage}`, '_blank', 'noopener')
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
    openSpy.mockRestore()
  })

  it('has a back link to the collection form', async () => {
    renderPendingSend()
    await waitFor(() => expect(screen.getByText('Ramesh Kulkarni')).toBeInTheDocument())
    // AppShell renders the back link as "← <destination title>"; here the
    // destination is the collection form.
    expect(screen.getByRole('link', { name: /Collect Donation/ })).toHaveAttribute('href', '/collect')
  })

  it('shows the volunteer\'s own still-queued (not-yet-synced) outbox items with a "Waiting for signal" indicator and no Send button', async () => {
    outboxToArray.mockResolvedValue([
      {
        localId: 'local-1',
        donorName: 'Queued Donor',
        donorPhone: '9998887777',
        amountPaise: 20000,
        mode: 'cash',
        collectedBy: 'volunteer-1',
        queuedAt: '2026-01-01T00:00:01Z',
      },
    ])
    renderPendingSend()

    await waitFor(() => expect(screen.getByText('Queued Donor')).toBeInTheDocument())
    expect(screen.getByText('₹200.00')).toBeInTheDocument()
    expect(screen.getByText('Waiting for signal')).toBeInTheDocument()
    // The server-fetched row still gets its send buttons — only the queued
    // (not-yet-synced) row has none, since it has no public_token yet.
    expect(screen.getAllByRole('button', { name: 'SMS' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'WhatsApp' })).toHaveLength(1)
  })

  it('does not show outbox items belonging to a different volunteer', async () => {
    outboxToArray.mockResolvedValue([
      {
        localId: 'local-2',
        donorName: 'Someone Elses Entry',
        donorPhone: '111',
        amountPaise: 100,
        mode: 'cash',
        collectedBy: 'a-different-volunteer',
        queuedAt: '2026-01-01T00:00:01Z',
      },
    ])
    renderPendingSend()

    await waitFor(() => expect(screen.getByText('Ramesh Kulkarni')).toBeInTheDocument())
    expect(screen.queryByText('Someone Elses Entry')).not.toBeInTheDocument()
  })

  it('refetches the queued list when a queue:changed event fires', async () => {
    outboxToArray.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        localId: 'local-3',
        donorName: 'Late Arrival',
        donorPhone: '222',
        amountPaise: 5000,
        mode: 'upi',
        collectedBy: 'volunteer-1',
        queuedAt: '2026-01-01T00:00:01Z',
      },
    ])
    renderPendingSend()
    await waitFor(() => expect(outboxToArray).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Late Arrival')).not.toBeInTheDocument()

    window.dispatchEvent(new Event('queue:changed'))

    await waitFor(() => expect(screen.getByText('Late Arrival')).toBeInTheDocument())
  })

  it('shows the empty state only when both the server list and the queued list are empty', async () => {
    getPendingSendDonations.mockResolvedValue([])
    outboxToArray.mockResolvedValue([])
    renderPendingSend()
    await waitFor(() => expect(screen.getByText('No pending receipts to send.')).toBeInTheDocument())
  })

  // An offline donation reaches this tray with no collection-time language,
  // so the tray's own picker (preset from the mandal default) is what decides
  // the send language.
  it('presets its own picker from the mandal default and sends in it', async () => {
    getMandalDefaultLang.mockResolvedValue('mr')
    renderPendingSend()

    await waitFor(() => expect(screen.getByRole('radio', { name: 'मराठी' })).toBeChecked())

    fireEvent.click(screen.getByRole('button', { name: 'SMS' }))

    const expectedMessage = encodeURIComponent(
      'तुमच्या ₹501 वर्गणीबद्दल धन्यवाद. तुमची अधिकृत पावती येथे पहा: https://vinayak-mandal.example/r/42-tok-abc?lang=mr',
    )
    // v4: the stored legacy 10-digit phone is normalized to E.164 (+91…) before
    // the sms: link is built (send.ts / normalizeToE164).
    expect(window.location.href).toBe(`sms:+919876543210?body=${expectedMessage}`)
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
  })
})
