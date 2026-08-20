import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Tables } from '../src/lib/db/database.types'
import { strings } from '../src/lib/strings'
import { CollectionsScreen, DonorsContent } from '../src/features/collection/Collections'

// Per the established pattern (ExpensesScreen.test.tsx): mock lib/db/donations.ts
// and lib/db/void.ts directly, not the raw Supabase client. getDonations feeds
// the (capped) list, getDonationsLite the (uncapped) hero total and the donors
// view — both mocked, defaulting to the same rows.
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
// "collected by" line resolves in tests regardless of role), and the mandal's
// donation-source list for the hero split + the Source filter.
const { fetchMandalUserNames, getDonationSources } = vi.hoisted(() => ({
  fetchMandalUserNames: vi.fn(),
  getDonationSources: vi.fn(),
}))

vi.mock('../src/lib/db/users', () => ({ fetchMandalUserNames }))
vi.mock('../src/lib/db/config', () => ({ getDonationSources }))

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

const admin: Tables<'users'> = { ...volunteer, id: 'admin-1', name: 'Anita Admin', role: 'admin', auth_user_id: 'auth-uid-admin' }
const owner: Tables<'users'> = { ...volunteer, id: 'owner-1', name: 'Om Owner', role: 'owner', auth_user_id: 'auth-uid-owner' }

// Mutable so a single module-level useAuth mock can serve both the default
// volunteer tests and the admin/owner-only cleanup tests.
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

// A shop donation by a second collector, and one logged just now (the only
// "today" row).
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
  getDonationSources.mockResolvedValue(['Society', 'Shop', 'Other'])
})

const renderScreen = () => render(<MemoryRouter><CollectionsScreen /></MemoryRouter>)

const search = () => screen.getByRole('searchbox')
const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
const dialog = () => within(screen.getByRole('dialog'))
const totalHero = () => screen.getByText(t.totalEyebrow).closest('div')!.parentElement!

describe('CollectionsContent — the Collections & donors tab', () => {
  it('lists active donations and hides removed ones behind a filter toggle', async () => {
    renderScreen()

    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())
    const row = screen.getByRole('button', { name: /Ganesh Donor/ })
    // The design's mode mark is the mode's own name in uppercase — no emoji.
    expect(within(row).getByText('CASH')).toBeInTheDocument()
    expect(within(row).getByText('Society')).toBeInTheDocument()
    expect(row).toHaveTextContent('₹500.00')

    // A voided donation is out of the current ledger — hidden by default.
    expect(screen.queryByText('Duplicate Entry')).not.toBeInTheDocument()

    openFilters()
    fireEvent.click(dialog().getByRole('button', { name: /Show removed donations/ }))
    fireEvent.click(dialog().getByRole('button', { name: /^Show \d/ }))

    expect(screen.getByText('Duplicate Entry')).toBeInTheDocument()
    expect(screen.getByText(/Entered twice/)).toBeInTheDocument()
  })

  it('opens a row detail sheet with the donor contact, collector and receipt link', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Ganesh Donor/ }))

    const sheet = dialog()
    expect(sheet.getByRole('heading', { name: 'Ganesh Donor' })).toBeInTheDocument()
    // Phone: legacy 10-digit value normalized to E.164 for tel: + wa.me.
    expect(sheet.getByRole('link', { name: strings.app.call })).toHaveAttribute('href', 'tel:+919000000009')
    expect(sheet.getByRole('link', { name: strings.app.whatsApp }).getAttribute('href')).toContain('wa.me/919000000009')
    // Collected-by resolves through the id→name map.
    expect(sheet.getByText('Sita Volunteer')).toBeInTheDocument()
    // Receipt open link uses the /r/<receiptNo>-<token> shape.
    expect(sheet.getByRole('link', { name: t.detailOpenReceipt }).getAttribute('href')).toContain('/r/7-tok-1')
  })

  it('offers no edit on a donation — the books are append-only', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Ganesh Donor/ }))

    // forbid_financial_edit() refuses an UPDATE on a recorded donation, so an
    // "edit" affordance would be a button that can only fail.
    expect(dialog().queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument()
    expect(dialog().getByRole('button', { name: t.deleteConfirm })).toBeInTheDocument()
  })

  it('deletes a donation through the confirm dialog, calling voidRow with the typed reason', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Ganesh Donor/ }))
    fireEvent.click(dialog().getByRole('button', { name: t.deleteConfirm }))

    // Exactly one modal at a time: the detail sheet closes as the confirm opens.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.change(dialog().getByRole('textbox'), { target: { value: 'Wrong amount' } })
    fireEvent.click(dialog().getByRole('button', { name: t.deleteConfirm }))

    await waitFor(() => expect(voidRow).toHaveBeenCalledWith('donations', 'donation-1', 'Wrong amount'))
  })

  it('does not call voidRow when the confirm dialog is cancelled', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Ganesh Donor/ }))
    fireEvent.click(dialog().getByRole('button', { name: t.deleteConfirm }))
    fireEvent.click(dialog().getByRole('button', { name: strings.void.cancel }))

    expect(voidRow).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the danger zone behind Data cleanup, and the purges owner-only', async () => {
    auth.appUser = owner
    purgeDonations.mockResolvedValue(1)
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    // Nothing destructive is reachable from the list itself any more — it used
    // to sit one scroll below the rows.
    expect(screen.queryByRole('button', { name: t.purgeAllButton })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t.dataCleanup }))
    fireEvent.click(dialog().getByRole('button', { name: t.purgeRemovedButton }))

    // Confirm stays disabled until the exact phrase is typed.
    expect(dialog().getByRole('button', { name: t.purgeRemovedConfirm })).toBeDisabled()
    fireEvent.change(dialog().getByRole('textbox'), { target: { value: t.purgePhrase } })
    fireEvent.click(dialog().getByRole('button', { name: t.purgeRemovedConfirm }))

    await waitFor(() => expect(purgeDonations).toHaveBeenCalledWith('removed'))
  })

  it('hides the purges from a plain admin but keeps "clear all" in the cleanup sheet', async () => {
    auth.appUser = admin
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: t.dataCleanup }))

    // purge_donations() requires is_owner() server-side; an admin must not even
    // see the buttons for a call that would be rejected.
    expect(dialog().queryByRole('button', { name: t.purgeRemovedButton })).not.toBeInTheDocument()
    expect(dialog().queryByRole('button', { name: t.purgeAllButton })).not.toBeInTheDocument()
    expect(dialog().getByRole('button', { name: t.clearAllButton })).toBeInTheDocument()
  })

  it('keeps Data cleanup away from a volunteer entirely', async () => {
    auth.appUser = volunteer
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: t.dataCleanup })).not.toBeInTheDocument()
  })

  it('narrows the list by donor name, phone digits, receipt number and collector name', async () => {
    loadRows([activeDonation, voidedDonation, shopDonation])
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    // Name (case-insensitive, partial).
    fireEvent.change(search(), { target: { value: 'LAKSH' } })
    expect(screen.getByText('Lakshmi Traders')).toBeInTheDocument()
    expect(screen.queryByText('Ganesh Donor')).not.toBeInTheDocument()

    // Phone digits — the legacy 10-digit row matches its own digits.
    fireEvent.change(search(), { target: { value: '9000 0000' } })
    expect(screen.getByText('Ganesh Donor')).toBeInTheDocument()
    expect(screen.queryByText('Lakshmi Traders')).not.toBeInTheDocument()

    // Receipt number, "#" tolerated; a short digit query is a receipt, not a
    // phone fragment (so "7" does not match every phone containing a 7).
    fireEvent.change(search(), { target: { value: '#12' } })
    expect(screen.getByText('Lakshmi Traders')).toBeInTheDocument()
    fireEvent.change(search(), { target: { value: '7' } })
    expect(screen.getByText('Ganesh Donor')).toBeInTheDocument()
    expect(screen.queryByText('Lakshmi Traders')).not.toBeInTheDocument()

    // Collector name via the id → name map.
    fireEvent.change(search(), { target: { value: 'raju' } })
    expect(screen.getByText('Lakshmi Traders')).toBeInTheDocument()

    // No match → the filtered-empty copy, never the "no donations yet" one.
    fireEvent.change(search(), { target: { value: 'zzz' } })
    expect(screen.getByText(t.noResultsTitle)).toBeInTheDocument()
    expect(screen.queryByText(t.empty)).not.toBeInTheDocument()
  })

  it('ANDs the search with the source filter, and one tap clears the chip', async () => {
    loadRows([activeDonation, voidedDonation, shopDonation])
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    fireEvent.change(search(), { target: { value: 'lakshmi' } })
    openFilters()
    fireEvent.click(dialog().getByRole('button', { name: 'Society' }))
    fireEvent.click(dialog().getByRole('button', { name: /^Show \d/ }))

    // Lakshmi is a shop donation, so Society + "lakshmi" is empty.
    expect(screen.getByText(t.noResultsTitle)).toBeInTheDocument()

    // The active filter is visible as a chip, and clearing it is one tap.
    fireEvent.click(screen.getByRole('button', { name: /^Society/ }))
    expect(screen.getByText('Lakshmi Traders')).toBeInTheDocument()
  })

  it('folds a legacy slug and its renamed twin into one Source option', async () => {
    // 'society' predates custom sources; 'Society' is the same source recorded
    // after the migration. One filter option must cover both.
    loadRows([activeDonation, { ...shopDonation, id: 'd9', category: 'Society', donor_name: 'New Society Row' }])
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    openFilters()
    expect(dialog().getAllByRole('button', { name: 'Society' })).toHaveLength(1)
    fireEvent.click(dialog().getByRole('button', { name: 'Society' }))
    fireEvent.click(dialog().getByRole('button', { name: /^Show \d/ }))

    expect(screen.getByText('Ganesh Donor')).toBeInTheDocument()
    expect(screen.getByText('New Society Row')).toBeInTheDocument()
  })

  it('keeps a removed source as a filter option while donations still carry it', async () => {
    // The mandal has renamed away from Shop; its rupees are still in the books.
    getDonationSources.mockResolvedValue(['Society', 'Galli'])
    loadRows([activeDonation, shopDonation])
    renderScreen()
    await waitFor(() => expect(screen.getByText('Lakshmi Traders')).toBeInTheDocument())

    openFilters()
    expect(dialog().getByRole('button', { name: 'Galli' })).toBeInTheDocument()
    expect(dialog().getByRole('button', { name: 'Shop' })).toBeInTheDocument()
  })

  it('filters by Today and by a picked day, in the local timezone', async () => {
    loadRows([activeDonation, voidedDonation, todayDonation])
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    openFilters()
    fireEvent.click(dialog().getByRole('button', { name: t.whenToday }))
    fireEvent.click(dialog().getByRole('button', { name: /^Show \d/ }))
    expect(screen.getByText('Today Donor')).toBeInTheDocument()
    expect(screen.queryByText('Ganesh Donor')).not.toBeInTheDocument()

    // "Pick a date" hands off to the shared day picker.
    openFilters()
    fireEvent.click(dialog().getByRole('button', { name: t.whenPickDate }))
    expect(dialog().getByRole('heading', { name: strings.ledger.pickerTitle })).toBeInTheDocument()
    fireEvent.click(dialog().getByRole('button', { name: strings.ledger.pickerJumpToday }))
    expect(screen.getByText('Today Donor')).toBeInTheDocument()
    expect(screen.queryByText('Ganesh Donor')).not.toBeInTheDocument()
    // The chip names the day it narrowed to.
    expect(screen.getByText(new RegExp(String(new Date().getFullYear())))).toBeInTheDocument()
  })

  it('sorts by amount and by name', async () => {
    loadRows([activeDonation, shopDonation])
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    openFilters()
    fireEvent.click(dialog().getByRole('button', { name: t.sortAmount }))
    fireEvent.click(dialog().getByRole('button', { name: /^Show \d/ }))
    const byAmount = screen.getAllByRole('button', { name: /Receipt #/ }).map((b) => b.textContent)
    expect(byAmount[0]).toContain('Lakshmi Traders')

    openFilters()
    fireEvent.click(dialog().getByRole('button', { name: t.sortName }))
    fireEvent.click(dialog().getByRole('button', { name: /^Show \d/ }))
    const byName = screen.getAllByRole('button', { name: /Receipt #/ }).map((b) => b.textContent)
    expect(byName[0]).toContain('Ganesh Donor')
  })

  it('shows a filter-aware total that never counts removed rows', async () => {
    loadRows([activeDonation, voidedDonation, shopDonation])
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    // Unfiltered: ₹500 + ₹1,200 (the ₹900 removed row does not count).
    expect(totalHero()).toHaveTextContent('₹1,700.00')
    expect(totalHero()).toHaveTextContent(t.donationsUnit(2))

    // A filter that leaves only the removed row: listed, but ₹0.
    fireEvent.change(search(), { target: { value: 'duplicate' } })
    openFilters()
    fireEvent.click(dialog().getByRole('button', { name: /Show removed donations/ }))
    fireEvent.click(dialog().getByRole('button', { name: /^Show \d/ }))
    expect(screen.getByText('Duplicate Entry')).toBeInTheDocument()
    expect(totalHero()).toHaveTextContent('₹0.00')

    // A filter with active rows: the total follows it.
    fireEvent.change(search(), { target: { value: 'lakshmi' } })
    expect(totalHero()).toHaveTextContent('₹1,200.00')
  })

  it('takes the total from the uncapped lite rows, so it includes what the capped list dropped', async () => {
    getDonations.mockResolvedValue([activeDonation])
    getDonationsLite.mockResolvedValue([activeDonation, { ...shopDonation, amount_paise: 100000 }])
    renderScreen()
    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

    expect(screen.queryByText('Lakshmi Traders')).not.toBeInTheDocument()
    expect(totalHero()).toHaveTextContent('₹1,500.00')
    expect(totalHero()).toHaveTextContent(t.donationsUnit(2))
  })

  it('still shows the list (without the total hero) when only the lite fetch fails', async () => {
    getDonations.mockResolvedValue([activeDonation, voidedDonation])
    getDonationsLite.mockRejectedValue(new Error('network down'))
    renderScreen()

    await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(t.totalEyebrow)).not.toBeInTheDocument()
  })

  // The design merges the old Donors page in as a second view of the same money.
  describe('donors view', () => {
    it('groups the same filtered money by person', async () => {
      loadRows([
        activeDonation,
        // Same phone as activeDonation, different spelling of the name — one donor.
        { ...activeDonation, id: 'd5', receipt_no: 9, donor_name: 'Ganesh D.', amount_paise: 10000, donor_phone: '+919000000009' },
        shopDonation,
        // Voided: no donor row, no rupees.
        voidedDonation,
      ])
      renderScreen()
      await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

      fireEvent.click(screen.getByRole('button', { name: /^Donors · / }))

      const rows = screen.getAllByRole('button', { name: /First / })
      expect(rows).toHaveLength(2)
      // ₹500 + ₹100 under one donor.
      expect(rows.map((r) => r.textContent).join(' ')).toContain('₹600.00')
      expect(screen.queryByText('Duplicate Entry')).not.toBeInTheDocument()
    })

    it('narrows both views at once, so the total always matches the view', async () => {
      loadRows([activeDonation, shopDonation])
      renderScreen()
      await waitFor(() => expect(screen.getByText('Ganesh Donor')).toBeInTheDocument())

      fireEvent.click(screen.getByRole('button', { name: /^Donors · / }))
      fireEvent.change(search(), { target: { value: 'lakshmi' } })

      expect(screen.getAllByRole('button', { name: /First / })).toHaveLength(1)
      expect(totalHero()).toHaveTextContent('₹1,200.00')
    })

    it('opens a donor sheet with their total, contact and history', async () => {
      loadRows([activeDonation, { ...activeDonation, id: 'd5', receipt_no: 9, amount_paise: 10000 }])
      renderScreen()
      // Two rows from the same donor, so the name is on screen twice.
      await waitFor(() => expect(screen.getAllByText('Ganesh Donor')).toHaveLength(2))

      fireEvent.click(screen.getByRole('button', { name: /^Donors · / }))
      fireEvent.click(screen.getByRole('button', { name: /First / }))

      const sheet = dialog()
      expect(sheet.getByText(t.donorGivenTotal)).toBeInTheDocument()
      expect(sheet.getByRole('link', { name: strings.app.whatsApp }).getAttribute('href')).toContain('wa.me/919000000009')
      expect(sheet.getByText(t.donorHistoryTitle)).toBeInTheDocument()
      expect(sheet.getAllByText(/Cash · Society/)).toHaveLength(2)
    })

    it('says so when a donor left no number', async () => {
      loadRows([todayDonation])
      renderScreen()
      await waitFor(() => expect(screen.getByText('Today Donor')).toBeInTheDocument())

      fireEvent.click(screen.getByRole('button', { name: /^Donors · / }))
      fireEvent.click(screen.getByRole('button', { name: /First / }))

      expect(dialog().getByText(t.donorNoPhoneNote)).toBeInTheDocument()
    })

    it('/admin/donors lands straight on the donors view', async () => {
      loadRows([activeDonation])
      render(<MemoryRouter><DonorsContent /></MemoryRouter>)

      await waitFor(() => expect(screen.getByRole('button', { name: /First / })).toBeInTheDocument())
      expect(screen.getByRole('button', { name: /^Donors · / })).toHaveAttribute('aria-pressed', 'true')
    })
  })
})
