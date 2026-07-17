import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { Tables } from '../src/lib/db/database.types'
import { AdminTransparency } from '../src/features/transparency/AdminTransparency'

const { getMandal, updateMandal } = vi.hoisted(() => ({
  getMandal: vi.fn(),
  updateMandal: vi.fn(),
}))

vi.mock('../src/lib/db/config', () => ({ getMandal, updateMandal }))

const { getTransparencyReport, getTransparencyCategories } = vi.hoisted(() => ({
  getTransparencyReport: vi.fn(),
  getTransparencyCategories: vi.fn(),
}))

vi.mock('../src/lib/db/transparency', () => ({ getTransparencyReport, getTransparencyCategories }))

const MANDAL_ID = '11111111-1111-1111-1111-000000000001'

const config: Tables<'mandals'> = {
  id: MANDAL_ID,
  name: 'Vinayak Mitra Mandal',
  slug: 'vinayak-mitra-mandal',
  state: null,
  address: null,
  creator_phone: null,
  logo_url: null,
  signature_url: null,
  upi_vpa: null,
  upi_qr_url: null,
  receipt_prefix: 'VM',
  expense_categories: ['Mandap'],
  bank_opening_paise: 0,
  transparency_published: false,
  default_lang: 'en',
  next_receipt_no: 1,
  created_at: '2026-07-17T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  getMandal.mockResolvedValue(config)
  getTransparencyReport.mockResolvedValue({ totalCollectedPaise: 100000, totalExpensesPaise: 0 })
  getTransparencyCategories.mockResolvedValue([])
  updateMandal.mockResolvedValue(undefined)
})

describe('AdminTransparency', () => {
  it('previews the aggregate even when unpublished, and toggling calls updateMandal with its own id', async () => {
    render(<AdminTransparency />)

    await waitFor(() => expect(screen.getByText('₹1,000')).toBeInTheDocument())
    expect(screen.getByText('Not visible to the public yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(updateMandal).toHaveBeenCalledWith(MANDAL_ID, { transparency_published: true }))
  })

  // The admin preview must read its OWN mandal's report — the RPCs are
  // slug-addressed now, and the migration's admin bypass is same-mandal
  // only, so passing anything but this slug returns zero rows.
  it('passes its own mandal slug to the transparency RPCs', async () => {
    render(<AdminTransparency />)

    await waitFor(() => expect(getTransparencyReport).toHaveBeenCalledWith('vinayak-mitra-mandal'))
    expect(getTransparencyCategories).toHaveBeenCalledWith('vinayak-mitra-mandal')
  })

  it('shows the shareable public link for its own slug', async () => {
    render(<AdminTransparency />)

    await waitFor(() =>
      expect(screen.getByText(`${window.location.origin}/transparency/vinayak-mitra-mandal`)).toBeInTheDocument(),
    )
  })
})
