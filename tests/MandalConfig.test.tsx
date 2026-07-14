import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { Tables } from '../src/lib/db/database.types'
import { MandalConfigScreen } from '../src/features/settings/MandalConfig'

// Per the brief's testing section: mock src/lib/db/config.ts directly
// (not the raw Supabase client) — this is a component test of the form
// behavior, not a re-test of config.ts's own query shape (that's
// tests/config.test.ts).
const { getMandalConfig, updateMandalConfig, uploadMandalAsset } = vi.hoisted(() => ({
  getMandalConfig: vi.fn(),
  updateMandalConfig: vi.fn(),
  uploadMandalAsset: vi.fn(),
}))

vi.mock('../src/lib/db/config', () => ({
  getMandalConfig,
  updateMandalConfig,
  uploadMandalAsset,
}))

const existingConfig: Tables<'mandal_config'> = {
  id: true,
  name: 'Vinayak Mitra Mandal',
  logo_url: null,
  signature_url: null,
  upi_vpa: 'mandal@upi',
  upi_qr_url: null,
  receipt_prefix: 'VM',
  expense_categories: ['Mandap', 'Prasad'],
  bank_opening_paise: 500000, // ₹5000
}

beforeEach(() => {
  vi.clearAllMocks()
  getMandalConfig.mockResolvedValue(existingConfig)
  updateMandalConfig.mockResolvedValue(undefined)
})

describe('MandalConfigScreen', () => {
  it('renders existing values, converting bank_opening_paise back to rupees', async () => {
    render(<MandalConfigScreen />)

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
    render(<MandalConfigScreen />)

    await waitFor(() => expect(screen.getByLabelText('Mandal name')).toHaveValue('Vinayak Mitra Mandal'))

    fireEvent.change(screen.getByLabelText('Bank opening balance (₹)'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => expect(updateMandalConfig).toHaveBeenCalledTimes(1))
    expect(updateMandalConfig).toHaveBeenCalledWith(
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
    render(<MandalConfigScreen />)

    await waitFor(() => expect(screen.getByLabelText('Mandal name')).toHaveValue('Vinayak Mitra Mandal'))

    const file = new File(['x'], 'logo.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Logo'), { target: { files: [file] } })

    await waitFor(() => expect(uploadMandalAsset).toHaveBeenCalledWith('logo', file))
    await waitFor(() =>
      expect(screen.getByAltText('Logo')).toHaveAttribute('src', 'https://example.com/mandal-assets/logo-1.png'),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() =>
      expect(updateMandalConfig).toHaveBeenCalledWith(
        expect.objectContaining({ logo_url: 'https://example.com/mandal-assets/logo-1.png' }),
      ),
    )
  })

  it('adds and removes expense category tags', async () => {
    render(<MandalConfigScreen />)

    await waitFor(() => expect(screen.getByLabelText('Mandal name')).toHaveValue('Vinayak Mitra Mandal'))

    fireEvent.change(screen.getByLabelText('Add a category'), { target: { value: 'Sound' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Sound')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove category: Mandap' }))
    expect(screen.queryByText('Mandap')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() =>
      expect(updateMandalConfig).toHaveBeenCalledWith(
        expect.objectContaining({ expense_categories: ['Prasad', 'Sound'] }),
      ),
    )
  })

  it('shows an error instead of a saved confirmation when updateMandalConfig rejects', async () => {
    updateMandalConfig.mockRejectedValue(new Error('permission denied'))
    render(<MandalConfigScreen />)

    await waitFor(() => expect(screen.getByLabelText('Mandal name')).toHaveValue('Vinayak Mitra Mandal'))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('permission denied'))
    expect(screen.queryByText('Settings saved.')).not.toBeInTheDocument()
  })
})
