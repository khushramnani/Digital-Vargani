import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Tables } from '../src/lib/db/database.types'
import { strings } from '../src/lib/strings'
import { formatLocalDay } from '../src/lib/dayFilter'
import { CollectionsScreen } from '../src/features/collection/Collections'

// Per the established pattern (ExpensesScreen.test.tsx): mock
// lib/db/donations.ts and lib/db/void.ts directly, not the raw Supabase
// client. getDonations feeds the (capped) list, getDonationsLite the
// (uncapped) totals strip — both mocked, defaulting to the same rows.
const { getDonations, getDonationsLite } = vi.hoisted(() => ({ getDonations: vi.fn(), getDonationsLite: vi.fn() }))

vi.mock('../src/lib/db/donations', () => ({ getDonations, getDonationsLite }))

const t = strings.collections

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

const owner: Tables<'users'> = {
  ...volunteer,
  id: 'owner-1',
  name: 'Om Owner',
  role: 'owner',
  auth_user_id: 'auth-uid-owner',
}

// Mutable so a single module-level useAuth mock can serve both the default
// volunteer tests and the admin/owner-only Danger Zone tests.
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

// Two more rows for the search / date / totals tests: a shop donation by a
// second collector, and one logged just now (the only "today" row).
const shopDonation: Tables<'donations'> = {
  ...activeDonation,
  id: 'donation-3',
  receipt_no: 12,
  public_token: 'tok-3',
  donor_name: 'Lakshmi Traders',
  donor_phone: '+919111122222',
  amount_paise: 120000,
  mode: 'upi',
  category: 'shop',
  collected_by: 'volunteer-2',
  created_at: '2026-01-04T06:00:00Z',
}

const todayDonation: Tables<'donations'> = {
  ...activeDonation,
  id: 'donation-4',
  receipt_no: 20,
  public_token: 'tok-4',
  donor_name: 'Today Donor',
  donor_phone: null,
  amount_paise: 12300,
  created_at: new Date().toISOString(),
}

// Loads the given rows into BOTH mocks (list + totals) — the default shape.
function loadRows(rows: Tables<'donations'>[]) {
  getDonations.mockResolvedValue(rows)
  getDonationsLite.mockResolvedValue(rows)
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.appUser = volunteer
  loadRows([activeDonation, voidedDonation])
  voidRow.mockResolvedValue(undefined)
  fetchMandalUserNames.mockResolvedValue({ 'volunteer-1': 'Sita Volunteer', 'volunteer-2': 'Raju Helper' })
})

describe('CollectionsScreen', () => {
  it('shows active donations with a Delete action and hides removed ones until toggled', async () => {
    render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())
    expect(within(screen.getByRole('button', { name: /Ganesh Donor/ })).getByText('₹500.00')).toBeInTheDocument()
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

  it('permanently purges removed donations once the exact phrase is typed (owner only)', async () => {
    auth.appUser = owner
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

  it('hides the purge buttons from a plain admin but keeps "clear all" visible', async () => {
    auth.appUser = admin
    render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    // purge_donations() now requires is_owner() server-side; an admin (not
    // owner) must not even see the buttons for a call that would be rejected.
    expect(screen.queryByRole('button', { name: 'Permanently delete removed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Permanently delete ALL history' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear all donations' })).toBeInTheDocument()
  })

  // Plan 2026-08-16 §3a: one search box over name, phone digits, receipt
  // number and (admin) collector name, AND-ed with the other filters.
  it('search narrows the list by donor name, phone digits, receipt number and collector name', async () => {
    loadRows([activeDonation, voidedDonation, shopDonation])
    render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())
    const search = screen.getByRole('searchbox', { name: t.searchPlaceholder })

    // Name (case-insensitive, partial).
    fireEvent.change(search, { target: { value: 'LAKSH' } })
    expect(screen.getByText('Lakshmi Traders')).toBeInTheDocument()
    expect(screen.queryByText('Ganesh Donor')).not.toBeInTheDocument()

    // Phone digits — the legacy 10-digit row matches its own digits.
    fireEvent.change(search, { target: { value: '9000 0000' } })
    expect(screen.getByText('Ganesh Donor')).toBeInTheDocument()
    expect(screen.queryByText('Lakshmi Traders')).not.toBeInTheDocument()

    // Receipt number, "#" tolerated; a short digit query is a receipt, not a
    // phone fragment (so "1" does not match every phone containing a 1).
    fireEvent.change(search, { target: { value: '#12' } })
    expect(screen.getByText('Lakshmi Traders')).toBeInTheDocument()
    expect(screen.queryByText('Ganesh Donor')).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: '7' } })
    expect(screen.getByText('Ganesh Donor')).toBeInTheDocument()
    expect(screen.queryByText('Lakshmi Traders')).not.toBeInTheDocument()

    // Collector name via the id → name map.
    fireEvent.change(search, { target: { value: 'raju' } })
    expect(screen.getByText('Lakshmi Traders')).toBeInTheDocument()
    expect(screen.queryByText('Ganesh Donor')).not.toBeInTheDocument()

    // Composes with the source filter (AND): Lakshmi is a shop donation.
    fireEvent.change(screen.getByRole('combobox', { name: t.detailCategory }), { target: { value: 'society' } })
    expect(screen.getByText(t.noFilterResults)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: t.detailCategory }), { target: { value: 'all' } })

    // No match → the filtered-empty copy, never the "no donations yet" one.
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText(t.noFilterResults)).toBeInTheDocument()
    expect(screen.queryByText(t.empty)).not.toBeInTheDocument()
  })

  // Plan 2026-08-16 §3b: All / Today / a picked day, decided in the device's
  // local timezone (lib/dayFilter.ts).
  it('filters by Today or by a picked date', async () => {
    loadRows([activeDonation, voidedDonation, todayDonation])
    render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())
    const dateSelect = screen.getByRole('combobox', { name: t.dateFilterLabel })

    fireEvent.change(dateSelect, { target: { value: 'today' } })
    expect(screen.getByText('Today Donor')).toBeInTheDocument()
    expect(screen.queryByText('Ganesh Donor')).not.toBeInTheDocument()

    // "Pick date" reveals a date input pre-set to today; changing it filters
    // to that (local) day.
    fireEvent.change(dateSelect, { target: { value: 'pick' } })
    const dateInput = screen.getByLabelText(t.dateFilterPick)
    expect(dateInput).toHaveValue(formatLocalDay(new Date()))
    expect(screen.getByText('Today Donor')).toBeInTheDocument()
    fireEvent.change(dateInput, { target: { value: formatLocalDay(new Date(activeDonation.created_at)) } })
    expect(screen.getByText('Ganesh Donor')).toBeInTheDocument()
    expect(screen.queryByText('Today Donor')).not.toBeInTheDocument()

    // Clearing the date input drops the date filter altogether.
    fireEvent.change(dateInput, { target: { value: '' } })
    expect(screen.getByText('Ganesh Donor')).toBeInTheDocument()
    expect(screen.getByText('Today Donor')).toBeInTheDocument()
    expect(screen.queryByLabelText(t.dateFilterPick)).not.toBeInTheDocument()
  })

  // Plan 2026-08-16 §3c: the totals strip describes the CURRENT filter, counts
  // non-voided rows only (even with "Show removed" on), and reads from the
  // uncapped lite rows rather than the capped list.
  it('shows a totals strip for the filtered view that never counts removed rows', async () => {
    loadRows([activeDonation, voidedDonation, shopDonation])
    render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    // Unfiltered: ₹500 + ₹1,200 (the ₹900 removed row does not count).
    // The strip is one <p> whose text reads "Total: ₹X · N donations".
    const strip = () => screen.getByText(new RegExp(`^${t.totalPrefix.trim()}`))
    const reads = (total: string, count: number) => `${t.totalPrefix}${total} · ${count}${t.donationsSuffix}`
    expect(strip()).toHaveTextContent(reads('₹1,700.00', 2))

    // Revealing removed rows changes what is listed, not the money.
    fireEvent.click(screen.getByRole('button', { name: /Show removed/ }))
    expect(screen.getByText('Duplicate Entry')).toBeInTheDocument()
    expect(strip()).toHaveTextContent(reads('₹1,700.00', 2))

    // A filter that leaves only the removed row: listed, but ₹0 · 0 donations.
    fireEvent.change(screen.getByRole('searchbox', { name: t.searchPlaceholder }), { target: { value: 'duplicate' } })
    expect(screen.getByText('Duplicate Entry')).toBeInTheDocument()
    expect(strip()).toHaveTextContent(reads('₹0.00', 0))

    // A filter with active rows: the strip follows it.
    fireEvent.change(screen.getByRole('searchbox', { name: t.searchPlaceholder }), { target: { value: 'lakshmi' } })
    expect(strip()).toHaveTextContent(reads('₹1,200.00', 1))

    // Filtered to nothing → no strip at all.
    fireEvent.change(screen.getByRole('searchbox', { name: t.searchPlaceholder }), { target: { value: 'zzz' } })
    expect(screen.queryByText(new RegExp(`^${t.totalPrefix.trim()}`))).not.toBeInTheDocument()
  })

  it('totals come from the uncapped lite rows, so they include donations the capped list dropped', async () => {
    getDonations.mockResolvedValue([activeDonation])
    // The lite query returns one more (non-voided) row than the list did.
    getDonationsLite.mockResolvedValue([activeDonation, { ...shopDonation, amount_paise: 100000 }])
    render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    expect(screen.queryByText('Lakshmi Traders')).not.toBeInTheDocument()
    expect(screen.getByText(new RegExp(`^${t.totalPrefix.trim()}`))).toHaveTextContent(
      `${t.totalPrefix}₹1,500.00 · 2${t.donationsSuffix}`,
    )
  })
})
