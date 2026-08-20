import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Tables } from '../src/lib/db/database.types'
import type { Handover } from '../src/lib/db/handovers'
import { strings } from '../src/lib/strings'
import { CashInHandContent } from '../src/features/cashinhand/CashInHand'

// Component test of the Cash tab body: mock the db modules, keep the real
// lib/reconcile.ts (volunteerCashInHand is exhaustively unit-tested there), so
// what is asserted here is the screen's behaviour over real arithmetic.
const { fetchLedgerRows, fetchActiveVolunteers } = vi.hoisted(() => ({
  fetchLedgerRows: vi.fn(),
  fetchActiveVolunteers: vi.fn(),
}))
const { createHandover, getAdmins, getHandovers } = vi.hoisted(() => ({
  createHandover: vi.fn(),
  getAdmins: vi.fn(),
  getHandovers: vi.fn(),
}))
const { voidRow } = vi.hoisted(() => ({ voidRow: vi.fn() }))

vi.mock('../src/lib/db/ledger', () => ({ fetchLedgerRows, fetchActiveVolunteers }))
vi.mock('../src/lib/db/handovers', () => ({ createHandover, getAdmins, getHandovers }))
vi.mock('../src/lib/db/void', () => ({ voidRow }))

const t = strings.cashInHand

const admin: Tables<'users'> = {
  id: 'admin-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  name: 'Anita Admin',
  phone: null,
  email: null,
  role: 'admin',
  auth_user_id: 'auth-uid-admin',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
}
const volunteer: Tables<'users'> = { ...admin, id: 'v-1', name: 'Sita Volunteer', role: 'volunteer', auth_user_id: 'auth-uid-v1' }

const auth = vi.hoisted(() => ({ appUser: null as Tables<'users'> | null }))

vi.mock('../src/features/auth/useAuth', () => ({
  useAuth: () => ({
    session: { user: { id: auth.appUser?.auth_user_id ?? 'auth-uid-admin' } },
    appUser: auth.appUser,
    loading: false,
    refreshAppUser: vi.fn(),
  }),
}))

// v-1 collected ₹1,000 cash and handed nothing; v-2 collected ₹200 and handed
// all of it. So v-1 owes ₹1,000, v-2 is settled, and the mandal is holding
// ₹1,000 outside the box.
const ledgerRows = {
  donations: [
    { amountPaise: 100000, mode: 'cash' as const, collectedBy: 'v-1', voided: false },
    { amountPaise: 20000, mode: 'cash' as const, collectedBy: 'v-2', voided: false },
  ],
  expenses: [],
  handovers: [{ amountPaise: 20000, volunteerId: 'v-2', receivedBy: 'admin-1', voided: false }],
}

const handoverRow: Handover = {
  id: 'h-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  amount_paise: 20000,
  volunteer_id: 'v-2',
  received_by: 'admin-1',
  note: 'at the mandap',
  created_at: '2026-01-05T00:00:00Z',
  voided: false,
  void_reason: null,
  voided_by: null,
  voided_at: null,
  volunteer: { name: 'Raju Helper' },
  received_by_user: { name: 'Anita Admin' },
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.appUser = admin
  fetchLedgerRows.mockResolvedValue(ledgerRows)
  fetchActiveVolunteers.mockResolvedValue([
    { id: 'v-1', name: 'Sita Volunteer' },
    { id: 'v-2', name: 'Raju Helper' },
  ])
  getAdmins.mockResolvedValue([
    { id: 'admin-1', name: 'Anita Admin' },
    { id: 'admin-2', name: 'Dhruvil Shah' },
  ])
  getHandovers.mockResolvedValue([handoverRow])
  createHandover.mockResolvedValue({ id: 'h-2' })
  voidRow.mockResolvedValue(undefined)
})

const renderScreen = () => render(<MemoryRouter><CashInHandContent /></MemoryRouter>)
const dialog = () => within(screen.getByRole('dialog'))

describe('CashInHandContent — the Cash tab (admin)', () => {
  it('leads with what is still outside the cash box, against what came in', async () => {
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.stillWithVolunteersEyebrow)).toBeInTheDocument())
    const heroEl = screen.getByText(t.stillWithVolunteersEyebrow).closest('div')!.parentElement!
    expect(heroEl).toHaveTextContent('₹1,000.00') // still with volunteers
    expect(heroEl).toHaveTextContent('₹1,200.00') // cash collected
    expect(heroEl).toHaveTextContent('₹200.00') // handed in
    expect(screen.getByText(t.stillHoldingCash(1, 2))).toBeInTheDocument()
  })

  it('lists who still owes with an explicit settle action, and marks the rest settled', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText('Sita Volunteer')).toBeInTheDocument())

    expect(screen.getByText(t.owingLabel(1))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${t.markSettled} · ₹1,000.00` })).toBeInTheDocument()
    // A settled volunteer is listed but has nothing to action.
    expect(screen.getByText('Raju Helper')).toBeInTheDocument()
    expect(screen.getByText(t.settledTag)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `${t.markSettled} · ₹200.00` })).not.toBeInTheDocument()
  })

  // The point of "Mark settled": the treasurer records the handover the
  // volunteer forgot to log, so it must be written against THAT volunteer.
  it('records the handover against the volunteer, not the acting admin', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText('Sita Volunteer')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: `${t.markSettled} · ₹1,000.00` }))
    expect(dialog().getByText(t.settleSheetHint('Sita Volunteer', '₹1,000.00'))).toBeInTheDocument()

    fireEvent.change(dialog().getByLabelText(t.amountReceivedLabel), { target: { value: '600' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Dhruvil Shah' }))
    fireEvent.change(dialog().getByLabelText(strings.handovers.noteLabel), { target: { value: ' handed at the mandap ' } })
    fireEvent.click(dialog().getByRole('button', { name: t.recordHandover }))

    await waitFor(() =>
      expect(createHandover).toHaveBeenCalledWith({
        amountPaise: 60000,
        receivedBy: 'admin-2',
        note: 'handed at the mandap',
        volunteerId: 'v-1',
      }),
    )
  })

  it('fills the full owed amount in one tap, but does not force it', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText('Sita Volunteer')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: `${t.markSettled} · ₹1,000.00` }))

    // A partial handover is legitimate — they hand over what is on them.
    expect(dialog().getByLabelText(t.amountReceivedLabel)).toHaveValue(null)
    fireEvent.click(dialog().getByRole('button', { name: `${t.fullAmountPrefix}₹1,000.00` }))
    expect(dialog().getByLabelText(t.amountReceivedLabel)).toHaveValue(1000)
  })

  it('keeps the settle button inert until there is an amount and a receiver', async () => {
    getAdmins.mockResolvedValue([])
    renderScreen()
    await waitFor(() => expect(screen.getByText('Sita Volunteer')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: `${t.markSettled} · ₹1,000.00` }))

    // No admins to receive it → nothing to record against.
    fireEvent.change(dialog().getByLabelText(t.amountReceivedLabel), { target: { value: '100' } })
    expect(dialog().getByRole('button', { name: t.recordHandover })).toBeDisabled()
    expect(createHandover).not.toHaveBeenCalled()
  })

  it('shows the handover log and voids a handover through the confirm dialog', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText(t.handoverLogTitle)).toBeInTheDocument())
    expect(screen.getByText(t.handoverCount(1))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Raju Helper/ }))
    fireEvent.click(dialog().getByRole('button', { name: t.voidHandover }))

    // One modal at a time.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.change(dialog().getByRole('textbox'), { target: { value: 'counted twice' } })
    fireEvent.click(dialog().getByRole('button', { name: strings.handovers.voidButton }))

    await waitFor(() => expect(voidRow).toHaveBeenCalledWith('handovers', 'h-1', 'counted twice'))
  })

  it('says so when nothing has been handed over yet', async () => {
    getHandovers.mockResolvedValue([])
    renderScreen()
    await waitFor(() => expect(screen.getByText(t.noHandovers)).toBeInTheDocument())
  })

  // A volunteer whose cash-in-hand is NEGATIVE paid for something out of their
  // own pocket — the mandal owes them. Filing that under "Settled" would say
  // "nothing to do" about the one row where the treasurer owes money.
  it('says the mandal owes a volunteer who is out of pocket, rather than calling them settled', async () => {
    fetchLedgerRows.mockResolvedValue({
      donations: [],
      // v-3 spent ₹400 of their own cash on the mandal and collected nothing.
      expenses: [{ amountPaise: 40000, paidFrom: 'cash' as const, paidBy: 'v-3', voided: false }],
      handovers: [],
    })
    fetchActiveVolunteers.mockResolvedValue([{ id: 'v-3', name: 'Out Of Pocket' }])
    renderScreen()

    await waitFor(() => expect(screen.getByText('Out Of Pocket')).toBeInTheDocument())
    expect(screen.getByText(t.mandalOwesTag)).toBeInTheDocument()
    expect(screen.queryByText(t.settledTag)).not.toBeInTheDocument()
    // Shown as what the mandal owes, not as a negative balance.
    expect(screen.getByText('Out Of Pocket').closest('div')!.parentElement!).toHaveTextContent('₹400.00')
    expect(screen.getByText(t.outOfPocket(1))).toBeInTheDocument()
    // And explained once for the group, not repeated on every row.
    expect(screen.getAllByText(t.mandalOwesHint)).toHaveLength(1)
  })

  it('reports everyone settled rather than a zero owing count', async () => {
    fetchLedgerRows.mockResolvedValue({
      donations: [{ amountPaise: 20000, mode: 'cash' as const, collectedBy: 'v-2', voided: false }],
      expenses: [],
      handovers: [{ amountPaise: 20000, volunteerId: 'v-2', receivedBy: 'admin-1', voided: false }],
    })
    fetchActiveVolunteers.mockResolvedValue([{ id: 'v-2', name: 'Raju Helper' }])
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.everyoneSettled)).toBeInTheDocument())
    expect(screen.getByText(t.allSettledLabel)).toBeInTheDocument()
  })
})

describe('CashInHandContent — the volunteer view', () => {
  beforeEach(() => {
    auth.appUser = volunteer
    // RLS gives a volunteer only their own rows.
    fetchLedgerRows.mockResolvedValue({
      donations: [{ amountPaise: 100000, mode: 'cash' as const, collectedBy: 'v-1', voided: false }],
      expenses: [{ amountPaise: 15000, paidFrom: 'cash' as const, paidBy: 'v-1', voided: false }],
      handovers: [{ amountPaise: 25000, volunteerId: 'v-1', receivedBy: 'admin-1', voided: false }],
    })
    getHandovers.mockResolvedValue([{ ...handoverRow, volunteer_id: 'v-1', amount_paise: 25000 }])
  })

  it('shows what they owe the treasurer and how it was arrived at', async () => {
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.youOweLabel)).toBeInTheDocument())
    // 1000 collected − 150 spent for the mandal − 250 handed over = 600.
    expect(screen.getByText(t.youOweLabel).closest('div')!).toHaveTextContent('₹600.00')
    expect(screen.getByText(t.cashCollectedLabel)).toBeInTheDocument()
    expect(screen.getByText(t.spentOnMandalLabel)).toBeInTheDocument()
    expect(screen.getByText(t.handedOverLabel)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Hand cash to treasurer/ })).toHaveAttribute('href', '/volunteer/handover')
  })

  it('never offers a volunteer the settle-on-behalf action', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText(t.youOweLabel)).toBeInTheDocument())

    // handovers_volunteer_insert pins them to their own id, so settling for
    // someone else is not theirs to do — and neither is the per-volunteer list.
    expect(screen.queryByRole('button', { name: new RegExp(t.markSettled) })).not.toBeInTheDocument()
    expect(screen.queryByText(t.volunteersTitle)).not.toBeInTheDocument()
    expect(getAdmins).not.toHaveBeenCalled()
  })

  it('says they are settled up once nothing is outstanding', async () => {
    fetchLedgerRows.mockResolvedValue({
      donations: [{ amountPaise: 25000, mode: 'cash' as const, collectedBy: 'v-1', voided: false }],
      expenses: [],
      handovers: [{ amountPaise: 25000, volunteerId: 'v-1', receivedBy: 'admin-1', voided: false }],
    })
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.allSettled)).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /Hand cash to treasurer/ })).not.toBeInTheDocument()
  })
})
