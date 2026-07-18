import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Tables } from '../src/lib/db/database.types'
import type { Expense } from '../src/lib/db/expenses'
import { ExpensesScreen } from '../src/features/expenses/ExpensesScreen'

// Per the brief's testing section: mock src/lib/db/expenses.ts,
// src/lib/db/config.ts, and src/lib/db/void.ts directly (not the raw
// Supabase client) — this is a component test of the screen's behavior,
// same pattern as CollectionForm.test.tsx / MandalConfig.test.tsx.
const { createExpense, getExpenses } = vi.hoisted(() => ({
  createExpense: vi.fn(),
  getExpenses: vi.fn(),
}))

vi.mock('../src/lib/db/expenses', () => ({
  createExpense,
  getExpenses,
}))

const { voidRow } = vi.hoisted(() => ({ voidRow: vi.fn() }))

vi.mock('../src/lib/db/void', () => ({ voidRow }))

const { getExpenseCategories } = vi.hoisted(() => ({ getExpenseCategories: vi.fn() }))

vi.mock('../src/lib/db/config', () => ({ getExpenseCategories }))

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
  useAuth: () => ({
    session: { user: { id: 'auth-uid-admin' } },
    appUser: admin,
    loading: false,
    refreshAppUser: vi.fn(),
  }),
}))

const categories = ['Mandap', 'Prasad']

const activeExpense: Expense = {
  id: 'expense-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  category: 'Mandap',
  amount_paise: 250000,
  description: 'Tent rental',
  paid_by: 'volunteer-1',
  paid_from: 'cash',
  created_at: '2026-01-02T00:00:00Z',
  voided: false,
  void_reason: null,
  voided_by: null,
  voided_at: null,
  paid_by_user: { name: 'Sita Volunteer' },
}

const voidedExpense: Expense = {
  id: 'expense-2',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  category: 'Prasad',
  amount_paise: 50000,
  description: 'Sweets',
  paid_by: 'volunteer-1',
  paid_from: 'bank',
  created_at: '2026-01-01T00:00:00Z',
  voided: true,
  void_reason: 'Duplicate entry',
  voided_by: 'admin-1',
  voided_at: '2026-01-03T00:00:00Z',
  paid_by_user: { name: 'Sita Volunteer' },
}

const createdExpense: Expense = {
  id: 'expense-3',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  category: 'Mandap',
  amount_paise: 100100,
  description: 'Decorations',
  paid_by: 'admin-1',
  paid_from: 'cash',
  created_at: '2026-01-04T00:00:00Z',
  voided: false,
  void_reason: null,
  voided_by: null,
  voided_at: null,
  paid_by_user: { name: 'Admin User' },
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Mandap' } })
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Decorations' } })
  fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '1001' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  getExpenseCategories.mockResolvedValue(categories)
  getExpenses.mockResolvedValue([activeExpense, voidedExpense])
  createExpense.mockResolvedValue(createdExpense)
  voidRow.mockResolvedValue(undefined)
})

describe('ExpensesScreen', () => {
  it('renders existing expenses, including a voided one struck-through with its reason shown', async () => {
    render(<MemoryRouter><ExpensesScreen /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText('Tent rental')).toBeInTheDocument())
    expect(screen.getByText('₹2,500.00')).toBeInTheDocument()
    expect(screen.getAllByText(/Sita Volunteer/)).toHaveLength(2)

    expect(screen.getByText('Sweets')).toBeInTheDocument()
    expect(screen.getByText(/Duplicate entry/)).toBeInTheDocument()
    // Voided row has no Void button (only one non-voided row does).
    expect(screen.getAllByRole('button', { name: 'Void' })).toHaveLength(1)
  })

  it('converts rupees to paise and sends paidBy from the session, not the form, on submit', async () => {
    render(<MemoryRouter><ExpensesScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByLabelText('Category')).not.toBeDisabled())
    fillValidForm()

    fireEvent.click(screen.getByRole('button', { name: 'Log Expense' }))

    await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1))
    expect(createExpense).toHaveBeenCalledWith({
      category: 'Mandap',
      description: 'Decorations',
      amountPaise: 100100,
      paidFrom: 'cash',
      paidBy: 'admin-1',
    })
  })

  it('blocks submission and shows inline errors when the form is empty', async () => {
    render(<MemoryRouter><ExpensesScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByLabelText('Category')).not.toBeDisabled())

    fireEvent.click(screen.getByRole('button', { name: 'Log Expense' }))

    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(3)
    expect(createExpense).not.toHaveBeenCalled()
  })

  it('rejects a category that is not in the mandal-configured list', async () => {
    render(<MemoryRouter><ExpensesScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByLabelText('Category')).not.toBeDisabled())

    // A category dropdown only ever offers configured options, but the
    // validator itself must still reject anything else defensively.
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
    fireEvent.click(screen.getByRole('button', { name: 'Log Expense' }))

    expect(screen.getByText('Select a valid category.')).toBeInTheDocument()
    expect(createExpense).not.toHaveBeenCalled()
  })

  it('opens a confirm dialog and calls voidRow with the typed reason when Void is confirmed', async () => {
    render(<MemoryRouter><ExpensesScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Tent rental')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Void' }))

    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Wrong category' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Void' }))

    await waitFor(() => expect(voidRow).toHaveBeenCalledWith('expenses', 'expense-1', 'Wrong category'))
  })

  it('does not call voidRow when the confirm dialog is cancelled', async () => {
    render(<MemoryRouter><ExpensesScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Tent rental')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Void' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    expect(voidRow).not.toHaveBeenCalled()
  })
})
