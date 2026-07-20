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

const { voidRow, clearAllDonations, purgeDonations } = vi.hoisted(() => ({
  voidRow: vi.fn(),
  clearAllDonations: vi.fn(),
  purgeDonations: vi.fn(),
}))

vi.mock('../src/lib/db/void', () => ({ voidRow, clearAllDonations, purgeDonations }))

// collected_by → name lookup (admin-only server-side; mocked here so the
// "collected by" line resolves in tests regardless of role).
const { fetchMandalUserNames } = vi.hoisted(() => ({ fetchMandalUserNames: vi.fn() }))

vi.mock('../src/lib/db/users', () => ({ fetchMandalUserNames }))

// The offline outbox — only the purge('all') path touches it (best-effort clear).
const { outboxClear } = vi.hoisted(() => ({ outboxClear: vi.fn() }))

vi.mock('../src/lib/queue/db', () => ({ db: { outbox: { clear: outboxClear } } }))

const volunteer: Tables<'users'> = {
  id: 'volunteer-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  name: 'Sita Volunteer',
  phone: null,
  email: null,
  role: 'volunteer',
  auth_user_id: 'auth-uid-volunteer',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
}

const admin: Tables<'users'> = {
  ...volunteer,
  id: 'admin-1',
  name: 'Anita Admin',
  role: 'admin',
  auth_user_id: 'auth-uid-admin',
}

// Mutable so a single module-level useAuth mock can serve both the default
// volunteer tests and the admin-only Danger Zone purge test.
const auth = vi.hoisted(() => ({ appUser: null as Tables<'users'> | null }))

vi.mock('../src/features/auth/useAuth', () => ({
  useAuth: () => ({
    session: { user: { id: auth.appUser?.auth_user_id ?? 'auth-uid-volunteer' } },
    appUser: auth.appUser,
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
  category: 'society',
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
  auth.appUser = volunteer
  getDonations.mockResolvedValue([activeDonation, voidedDonation])
  voidRow.mockResolvedValue(undefined)
  fetchMandalUserNames.mockResolvedValue({ 'volunteer-1': 'Sita Volunteer' })
})

describe('CollectionsScreen', () => {
  it('shows active donations with a Delete action and hides removed ones until toggled', async () => {
    render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())
    expect(screen.getByText('₹500.00')).toBeInTheDocument()
    // A payment-mode icon tile per row (💵 cash / 📱 upi / 🏦 bank).
    expect(screen.getByText('💵')).toBeInTheDocument()
    // A voided donation is removed from the current ledger — hidden by default.
    expect(screen.queryByText('Duplicate Entry')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)

    // Reveal removed rows: struck-through with the reason, and no Delete action.
    fireEvent.click(screen.getByRole('button', { name: /Show removed/ }))
    expect(screen.getByText('Duplicate Entry')).toBeInTheDocument()
    expect(screen.getByText(/Entered twice/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)
  })

  it('expands a row to reveal donor contact, collector and receipt link', async () => {
    render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    // Tap the row header (its accessible name contains the donor name).
    fireEvent.click(screen.getByRole('button', { name: /Ganesh Donor/ }))

    // Phone: legacy 10-digit value normalized to E.164 for tel: + wa.me.
    const call = await screen.findByRole('link', { name: /Call/ })
    expect(call).toHaveAttribute('href', 'tel:+919000000009')
    const whatsApp = screen.getByRole('link', { name: /WhatsApp/ })
    expect(whatsApp.getAttribute('href')).toContain('wa.me/919000000009')

    // Collected-by resolves through the id→name map.
    expect(screen.getByText('Sita Volunteer')).toBeInTheDocument()

    // Receipt open link uses the /r/<receiptNo>-<token> shape.
    const open = screen.getByRole('link', { name: /Open receipt/ })
    expect(open.getAttribute('href')).toContain('/r/7-tok-1')
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

  it('permanently purges removed donations once the exact phrase is typed (admin only)', async () => {
    auth.appUser = admin
    purgeDonations.mockResolvedValue(1)
    render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete removed' }))
    const dialog = screen.getByRole('dialog')

    // Confirm stays disabled until the exact phrase is typed.
    const confirm = within(dialog).getByRole('button', { name: 'Delete removed forever' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'DELETE FOREVER' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete removed forever' }))

    await waitFor(() => expect(purgeDonations).toHaveBeenCalledWith('removed'))
  })
})
