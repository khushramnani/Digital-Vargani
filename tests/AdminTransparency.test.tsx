import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { Tables } from '../src/lib/db/database.types'
import { AdminTransparency } from '../src/features/transparency/AdminTransparency'

const { getMandalConfig, updateMandalConfig } = vi.hoisted(() => ({
  getMandalConfig: vi.fn(),
  updateMandalConfig: vi.fn(),
}))

vi.mock('../src/lib/db/config', () => ({ getMandalConfig, updateMandalConfig }))

const { getTransparencyReport, getTransparencyCategories } = vi.hoisted(() => ({
  getTransparencyReport: vi.fn(),
  getTransparencyCategories: vi.fn(),
}))

vi.mock('../src/lib/db/transparency', () => ({ getTransparencyReport, getTransparencyCategories }))

const config: Tables<'mandal_config'> = {
  id: true,
  name: 'Vinayak Mitra Mandal',
  logo_url: null,
  signature_url: null,
  upi_vpa: null,
  upi_qr_url: null,
  receipt_prefix: 'VM',
  expense_categories: ['Mandap'],
  bank_opening_paise: 0,
  transparency_published: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  getMandalConfig.mockResolvedValue(config)
  getTransparencyReport.mockResolvedValue({ totalCollectedPaise: 100000, totalExpensesPaise: 0 })
  getTransparencyCategories.mockResolvedValue([])
  updateMandalConfig.mockResolvedValue(undefined)
})

describe('AdminTransparency', () => {
  it('previews the aggregate even when unpublished, and toggling calls updateMandalConfig', async () => {
    render(<AdminTransparency />)

    await waitFor(() => expect(screen.getByText('₹1,000')).toBeInTheDocument())
    expect(screen.getByText('Not visible to the public yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(updateMandalConfig).toHaveBeenCalledWith({ transparency_published: true }))
  })
})
