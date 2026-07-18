import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Ledger } from '../src/lib/reconcile'
import type { Tables } from '../src/lib/db/database.types'
import { MasterLedgerScreen } from '../src/features/ledger/MasterLedger'

// AppShell (the frame the dashboard now renders inside) reads the session
// role via useAuth to pick its home link and show sign-out — mock it so the
// screen renders without a real AuthProvider.
const admin: Tables<'users'> = {
  id: 'admin-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  name: 'Admin User',
  phone: null,
  email: 'admin@example.com',
  role: 'admin',
  invite_token: null,
  auth_user_id: 'auth-uid-admin',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
}

vi.mock('../src/features/auth/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: 'auth-uid-admin' } }, appUser: admin, loading: false, refreshAppUser: vi.fn() }),
}))

// Mock lib/db/ledger.ts directly (not the raw Supabase client) — this is a
// component test of the screen's rendering, same pattern as
// ExpensesScreen.test.tsx. booksBalanceCheck/totalCollected/etc. are the
// real lib/reconcile.ts functions (already exhaustively unit-tested in
// reconcile.test.ts) — only the fetch is mocked.
const { fetchFullLedger } = vi.hoisted(() => ({ fetchFullLedger: vi.fn() }))

vi.mock('../src/lib/db/ledger', () => ({ fetchFullLedger }))

const balancedLedger: Ledger = {
  users: [{ id: 'v-1', role: 'volunteer' }],
  donations: [{ amountPaise: 100000, mode: 'cash', collectedBy: 'v-1', voided: false }],
  expenses: [],
  handovers: [{ amountPaise: 100000, volunteerId: 'v-1', receivedBy: 'admin-1', voided: false }],
  bankOpeningPaise: 0,
}

// A genuine imbalance the indicator must still catch: a handover recorded as
// coming FROM an admin. The identity assumes every handover is volunteer ->
// admin (see lib/reconcile.ts's proof comment); an admin-sourced handover is
// added to the treasurer's cash but subtracted from no volunteer, so LHS
// exceeds RHS. (Admin-collected *cash donations* used to imbalance too, but
// that is now handled by cashHeldByTreasurer — audit 2026-07-18 #1.)
const unbalancedLedger: Ledger = {
  users: [{ id: 'admin-1', role: 'admin' }],
  donations: [],
  expenses: [],
  handovers: [{ amountPaise: 100000, volunteerId: 'admin-1', receivedBy: 'admin-1', voided: false }],
  bankOpeningPaise: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
})

function renderScreen() {
  return render(
    <MemoryRouter>
      <MasterLedgerScreen />
    </MemoryRouter>,
  )
}

describe('MasterLedgerScreen', () => {
  it('shows totals and a green balanced indicator when the books-balance identity holds', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    renderScreen()

    // Total Collected and Net Balance are both ₹1,000 here (no expenses).
    await waitFor(() => expect(screen.getAllByText('₹1,000')).toHaveLength(2))
    expect(screen.getByRole('status')).toHaveTextContent('Books balanced')
  })

  it('shows a red indicator with the discrepancy amount when the identity does not hold', async () => {
    fetchFullLedger.mockResolvedValue(unbalancedLedger)
    renderScreen()

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Discrepancy: ₹1,000')
  })

  it('links to the volunteer collection form so an admin can log a donation as themselves', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    renderScreen()

    // The dashboard nav is now a card grid: each link's accessible name is
    // its label plus a one-line description, so match on the label substring.
    await waitFor(() => expect(screen.getByRole('link', { name: /Collect donation/ })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /Collect donation/ })).toHaveAttribute('href', '/collect')
  })

  it('links to the admin management screen', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    renderScreen()

    await waitFor(() => expect(screen.getByRole('link', { name: /Manage admins/ })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /Manage admins/ })).toHaveAttribute('href', '/admin/admins')
  })
})
