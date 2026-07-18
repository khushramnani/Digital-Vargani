import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Tables } from '../src/lib/db/database.types'
import { MandalConfigScreen } from '../src/features/settings/MandalConfig'

// Per the brief's testing section: mock src/lib/db/config.ts directly
// (not the raw Supabase client) — this is a component test of the form
// behavior, not a re-test of config.ts's own query shape (that's
// tests/config.test.ts).
const { getMandal, updateMandal, uploadMandalAsset } = vi.hoisted(() => ({
  getMandal: vi.fn(),
  updateMandal: vi.fn(),
  uploadMandalAsset: vi.fn(),
}))

vi.mock('../src/lib/db/config', () => ({
  getMandal,
  updateMandal,
  uploadMandalAsset,
}))

// The screen now renders inside AppShell, which reads the session role via
// useAuth (home link + sign-out). Mock it so no real AuthProvider is needed.
vi.mock('../src/features/auth/useAuth', () => ({
  useAuth: () => ({
    session: { user: { id: 'auth-uid-admin' } },
    appUser: { role: 'admin' },
    loading: false,
    refreshAppUser: vi.fn(),
  }),
}))

const MANDAL_ID = '11111111-1111-1111-1111-000000000001'

const existingConfig: Tables<'mandals'> = {
  id: MANDAL_ID,
  name: 'Vinayak Mitra Mandal',
  slug: 'vinayak-mitra-mandal',
  state: null,
  address: null,
  creator_phone: null,
  logo_url: null,
  signature_url: null,
  upi_vpa: 'mandal@upi',
  upi_qr_url: null,
  receipt_prefix: 'VM',
  expense_categories: ['Mandap', 'Prasad'],
  bank_opening_paise: 500000, // ₹5000
  transparency_published: false,
  default_lang: 'en',
  next_receipt_no: 1,
  created_at: '2026-07-17T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  getMandal.mockResolvedValue(existingConfig)
  updateMandal.mockResolvedValue(undefined)
})

describe('MandalConfigScreen', () => {
  it('renders existing values, converting bank_opening_paise back to rupees', async () => {
    render(<MemoryRouter><MandalConfigScreen /></MemoryRouter>)

    await waitFor(() => expect(screen.getByLabelText('Mandal name')).toHaveValue('Vinayak Mitra Mandal'))
    expect(screen.getByLabelText('UPI VPA')).toHaveValue('mandal@upi')
    expect(screen.getByLabelText('Bank opening balance (₹)')).toHaveValue(5000)
    expect(screen.getByText('Mandap')).toBeInTheDocument()
    expect(screen.getByText('Prasad')).toBeInTheDocument()
    // formatINR display alongside the input, proving toRupees/formatINR are
    // both actually wired up (not reimplemented).
    expect(screen.getByText('₹5,000')).toBeInTheDocument()
  })

  it('submits with bank_opening_paise converted from the rupees input via toPaise (5000 -> 500000)', async () => {
    render(<MemoryRouter><MandalConfigScreen /></MemoryRouter>)

    await waitFor(() => expect(screen.getByLabelText('Mandal name')).toHaveValue('Vinayak Mitra Mandal'))

    fireEvent.change(screen.getByLabelText('Bank opening balance (₹)'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => expect(updateMandal).toHaveBeenCalledTimes(1))
    expect(updateMandal).toHaveBeenCalledWith(
      MANDAL_ID,
      expect.objectContaining({
        bank_opening_paise: 500000,
        name: 'Vinayak Mitra Mandal',
        upi_vpa: 'mandal@upi',
        expense_categories: ['Mandap', 'Prasad'],
      }),
    )
    await waitFor(() => expect(screen.getByText('Settings saved.')).toBeInTheDocument())
  })

  it('uploads a selected logo file and includes the returned URL on save', async () => {
    uploadMandalAsset.mockResolvedValue('https://example.com/mandal-assets/logo-1.png')
    render(<MemoryRouter><MandalConfigScreen /></MemoryRouter>)

    await waitFor(() => expect(screen.getByLabelText('Mandal name')).toHaveValue('Vinayak Mitra Mandal'))

    const file = new File(['x'], 'logo.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Logo'), { target: { files: [file] } })

    // The mandal id leads the args now — the storage policy rejects an
    // upload whose path doesn't start with the caller's own mandal folder.
    await waitFor(() => expect(uploadMandalAsset).toHaveBeenCalledWith(MANDAL_ID, 'logo', file))
    await waitFor(() =>
      expect(screen.getByAltText('Logo')).toHaveAttribute('src', 'https://example.com/mandal-assets/logo-1.png'),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() =>
      expect(updateMandal).toHaveBeenCalledWith(
        MANDAL_ID,
        expect.objectContaining({ logo_url: 'https://example.com/mandal-assets/logo-1.png' }),
      ),
    )
  })

  it('adds and removes expense category tags', async () => {
    render(<MemoryRouter><MandalConfigScreen /></MemoryRouter>)

    await waitFor(() => expect(screen.getByLabelText('Mandal name')).toHaveValue('Vinayak Mitra Mandal'))

    fireEvent.change(screen.getByLabelText('Add a category'), { target: { value: 'Sound' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Sound')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove category: Mandap' }))
    expect(screen.queryByText('Mandap')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() =>
      expect(updateMandal).toHaveBeenCalledWith(
        MANDAL_ID,
        expect.objectContaining({ expense_categories: ['Prasad', 'Sound'] }),
      ),
    )
  })

  it('shows an error instead of a saved confirmation when updateMandal rejects', async () => {
    updateMandal.mockRejectedValue(new Error('permission denied'))
    render(<MemoryRouter><MandalConfigScreen /></MemoryRouter>)

    await waitFor(() => expect(screen.getByLabelText('Mandal name')).toHaveValue('Vinayak Mitra Mandal'))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('permission denied'))
    expect(screen.queryByText('Settings saved.')).not.toBeInTheDocument()
  })
})
