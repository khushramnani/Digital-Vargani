import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Tables } from '../src/lib/db/database.types'
import type { Expense } from '../src/lib/db/expenses'
import { strings } from '../src/lib/strings'
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

// getMandal/updateMandal are the admin-only path plan §3 uses to edit the
// mandal's expense_categories from this screen.
const { getExpenseCategories, getMandal, updateMandal } = vi.hoisted(() => ({
  getExpenseCategories: vi.fn(),
  getMandal: vi.fn(),
  updateMandal: vi.fn(),
}))

vi.mock('../src/lib/db/config', () => ({ getExpenseCategories, getMandal, updateMandal }))

const t = strings.expenses

const admin: Tables<'users'> = {
  id: 'admin-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  name: 'Admin User',
  phone: null,
  email: 'admin@example.com',
  role: 'admin',
  auth_user_id: 'auth-uid-admin',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
}

const volunteer: Tables<'users'> = {
  ...admin,
  id: 'volunteer-1',
  name: 'Sita Volunteer',
  role: 'volunteer',
  auth_user_id: 'auth-uid-volunteer',
}

// Mutable so one module-level useAuth mock serves both the admin tests and the
// volunteer gate below.
const auth = vi.hoisted(() => ({ appUser: null as Tables<'users'> | null }))

vi.mock('../src/features/auth/useAuth', () => ({
  useAuth: () => ({
    session: { user: { id: auth.appUser?.auth_user_id ?? 'auth-uid-admin' } },
    appUser: auth.appUser,
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
  ...activeExpense,
  id: 'expense-2',
  category: 'Prasad',
  amount_paise: 50000,
  description: 'Sweets',
  paid_from: 'bank',
  created_at: '2026-01-01T00:00:00Z',
  voided: true,
  void_reason: 'Duplicate entry',
  voided_by: 'admin-1',
  voided_at: '2026-01-03T00:00:00Z',
}

const createdExpense: Expense = {
  ...activeExpense,
  id: 'expense-3',
  amount_paise: 100100,
  description: 'Decorations',
  paid_by: 'admin-1',
  created_at: '2026-01-04T00:00:00Z',
  paid_by_user: { name: 'Admin User' },
}

const renderScreen = () => render(<MemoryRouter><ExpensesScreen /></MemoryRouter>)
const dialog = () => within(screen.getByRole('dialog'))
const openForm = () => fireEvent.click(screen.getByRole('button', { name: t.logAnExpense }))

function fillValidForm() {
  fireEvent.click(dialog().getByRole('button', { name: 'Mandap' }))
  fireEvent.change(dialog().getByLabelText(t.whatWasItFor), { target: { value: 'Decorations' } })
  fireEvent.change(dialog().getByLabelText(t.amountLabel), { target: { value: '1001' } })
  fireEvent.click(dialog().getByRole('button', { name: t.paidFromCash }))
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.appUser = admin
  getExpenseCategories.mockResolvedValue(categories)
  getExpenses.mockResolvedValue([activeExpense, voidedExpense])
  createExpense.mockResolvedValue(createdExpense)
  voidRow.mockResolvedValue(undefined)
  getMandal.mockResolvedValue({ id: 'mandal-1', expense_categories: categories })
  updateMandal.mockResolvedValue(undefined)
})

describe('ExpensesContent — the Expenses tab', () => {
  it('leads with what has been spent, split between the cash box and the bank', async () => {
    renderScreen()

    await waitFor(() => expect(screen.getByText(t.totalSpentEyebrow)).toBeInTheDocument())
    const heroEl = screen.getByText(t.totalSpentEyebrow).closest('div')!.parentElement!
    // Only the live ₹2,500 counts — the voided ₹500 row counts towards nothing.
    expect(heroEl).toHaveTextContent('₹2,500.00')
    expect(heroEl).toHaveTextContent(t.summaryLine(1, '₹2,500.00'))
    expect(heroEl).toHaveTextContent(`${t.paidFromCash} ₹2,500.00`)
    expect(heroEl).toHaveTextContent(`${t.paidFromBank} ₹0.00`)
  })

  it('shows spend by category, following the filters', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText(t.spendByCategoryTitle)).toBeInTheDocument())
    const card = within(screen.getByText(t.spendByCategoryTitle).closest('div')!.parentElement!)
    expect(card.getByText('Mandap')).toBeInTheDocument()
    expect(card.getByText(t.categoryCount(1))).toBeInTheDocument()
    // Prasad's only expense is voided, so it is not a category with spend.
    expect(card.queryByText('Prasad')).not.toBeInTheDocument()
  })

  it('lists expenses, and reveals a voided one only through the filter switch', async () => {
    renderScreen()

    await waitFor(() => expect(screen.getByText('Tent rental')).toBeInTheDocument())
    expect(screen.getByText(t.paidByAndFrom('Sita Volunteer', t.paidFromCash))).toBeInTheDocument()
    expect(screen.queryByText('Sweets')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    fireEvent.click(dialog().getByRole('button', { name: /Show voided expenses/ }))
    fireEvent.click(dialog().getByRole('button', { name: /^Show \d/ }))

    expect(screen.getByText(/Duplicate entry/)).toBeInTheDocument()
  })

  it('converts rupees to paise and sends paidBy from the session, not the form', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByRole('button', { name: t.logAnExpense })).toBeInTheDocument())
    openForm()
    fillValidForm()

    fireEvent.click(dialog().getByRole('button', { name: t.submitButton }))

    await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1))
    expect(createExpense).toHaveBeenCalledWith({
      category: 'Mandap',
      description: 'Decorations',
      amountPaise: 100100,
      paidFrom: 'cash',
      paidBy: 'admin-1',
    })
  })

  it('keeps the submit inert until a category, an amount and a source of funds are all chosen', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByRole('button', { name: t.logAnExpense })).toBeInTheDocument())
    openForm()

    const submit = () => dialog().getByRole('button', { name: t.submitButton })
    expect(submit()).toBeDisabled()
    fireEvent.click(dialog().getByRole('button', { name: 'Mandap' }))
    expect(submit()).toBeDisabled()
    fireEvent.change(dialog().getByLabelText(t.amountLabel), { target: { value: '100' } })
    expect(submit()).toBeDisabled()
    fireEvent.click(dialog().getByRole('button', { name: t.paidFromBank }))
    expect(submit()).toBeEnabled()
    expect(createExpense).not.toHaveBeenCalled()
  })

  it('opens a confirm dialog and calls voidRow with the typed reason', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText('Tent rental')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Tent rental/ }))
    fireEvent.click(dialog().getByRole('button', { name: t.voidThisExpense }))

    // One modal at a time: the detail sheet closes as the confirm opens.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.change(dialog().getByRole('textbox'), { target: { value: 'Wrong category' } })
    fireEvent.click(dialog().getByRole('button', { name: t.voidButton }))

    await waitFor(() => expect(voidRow).toHaveBeenCalledWith('expenses', 'expense-1', 'Wrong category'))
  })

  it('does not call voidRow when the confirm dialog is cancelled', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText('Tent rental')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Tent rental/ }))
    fireEvent.click(dialog().getByRole('button', { name: t.voidThisExpense }))
    fireEvent.click(dialog().getByRole('button', { name: strings.void.cancel }))

    expect(voidRow).not.toHaveBeenCalled()
  })

  it('offers no edit on an expense — the books are append-only', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText('Tent rental')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Tent rental/ }))

    // forbid_financial_edit() refuses an UPDATE on a recorded expense.
    expect(dialog().queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument()
    expect(dialog().getByRole('button', { name: t.voidThisExpense })).toBeInTheDocument()
  })

  it('searches category, note and payer', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByText('Tent rental')).toBeInTheDocument())

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'tent' } })
    expect(screen.getByText('Tent rental')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sita' } })
    expect(screen.getByText('Tent rental')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.getByText(strings.collections.noResultsTitle)).toBeInTheDocument()
  })

  // ── Plan 2026-08-18 §3 — category management lives here now ──────────────
  describe('category management', () => {
    it('lets an admin add and remove categories, saving the whole list once', async () => {
      renderScreen()
      await waitFor(() => expect(screen.getByRole('button', { name: t.manageCategoriesToggle })).toBeInTheDocument())

      fireEvent.click(screen.getByRole('button', { name: t.manageCategoriesToggle }))
      expect(dialog().getByRole('heading', { name: t.manageCategoriesTitle })).toBeInTheDocument()

      fireEvent.change(dialog().getByLabelText(t.addCategoryPlaceholder), { target: { value: 'Sound' } })
      fireEvent.click(dialog().getByRole('button', { name: t.addCategory }))
      fireEvent.click(dialog().getByRole('button', { name: `${t.removeCategory}: Prasad` }))
      fireEvent.click(dialog().getByRole('button', { name: strings.app.save }))

      // One write for the add plus the removal, not one per keystroke.
      await waitFor(() =>
        expect(updateMandal).toHaveBeenCalledWith('mandal-1', { expense_categories: ['Mandap', 'Sound'] }),
      )
      expect(updateMandal).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t.categoriesSaved))
    })

    it('refuses a duplicate category before it reaches the server', async () => {
      renderScreen()
      await waitFor(() => expect(screen.getByRole('button', { name: t.manageCategoriesToggle })).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: t.manageCategoriesToggle }))

      fireEvent.change(dialog().getByLabelText(t.addCategoryPlaceholder), { target: { value: 'mandap' } })
      fireEvent.click(dialog().getByRole('button', { name: t.addCategory }))

      expect(dialog().getByRole('alert')).toHaveTextContent(t.categoryDuplicateError)
      expect(updateMandal).not.toHaveBeenCalled()
    })

    it('adds a category inline from the expense form and preselects it', async () => {
      renderScreen()
      await waitFor(() => expect(screen.getByRole('button', { name: t.logAnExpense })).toBeInTheDocument())
      openForm()

      fireEvent.click(dialog().getByRole('button', { name: `＋ ${t.newCategoryChip}` }))
      fireEvent.change(dialog().getByLabelText(t.newCategoryPlaceholder), { target: { value: 'Sound' } })
      fireEvent.click(dialog().getByRole('button', { name: t.addCategory }))

      await waitFor(() =>
        expect(updateMandal).toHaveBeenCalledWith('mandal-1', { expense_categories: ['Mandap', 'Prasad', 'Sound'] }),
      )
      await waitFor(() => expect(dialog().getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'true'))
    })

    it('keeps category management away from a volunteer, whose write the server would refuse', async () => {
      auth.appUser = volunteer
      renderScreen()
      await waitFor(() => expect(screen.getByRole('button', { name: t.logAnExpense })).toBeInTheDocument())

      expect(screen.queryByRole('button', { name: t.manageCategoriesToggle })).not.toBeInTheDocument()
      // No admin-only request is even attempted for them.
      expect(getMandal).not.toHaveBeenCalled()

      openForm()
      // ...and no "＋ New" chip whose updateMandal call RLS would reject.
      expect(dialog().queryByRole('button', { name: `＋ ${t.newCategoryChip}` })).not.toBeInTheDocument()
      expect(dialog().getByRole('button', { name: 'Mandap' })).toBeInTheDocument()
    })
  })
})
