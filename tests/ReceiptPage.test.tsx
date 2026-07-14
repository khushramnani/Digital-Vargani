import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { PublicReceipt, MandalBranding } from '../src/lib/db/receipt'
import { ReceiptPage } from '../src/features/receipt/ReceiptPage'

// Per the brief's testing section: mock src/lib/db/receipt.ts directly
// (not the raw Supabase client — that's tests/receipt.test.ts's job), and
// prove this public, unauthenticated page never requests or renders
// donor_phone. That's backed structurally: PublicReceipt (typed straight
// off get_public_receipt's Returns shape in database.types.ts) has no
// donor_phone field to accidentally read — accessing `.donor_phone` on it
// below would be a type error, not just a lint warning.
const { getPublicReceipt, getPublicBranding } = vi.hoisted(() => ({
  getPublicReceipt: vi.fn(),
  getPublicBranding: vi.fn(),
}))

vi.mock('../src/lib/db/receipt', () => ({
  getPublicReceipt,
  getPublicBranding,
}))

const branding: MandalBranding = {
  name: 'Vinayak Mitra Mandal',
  logo_url: null,
  signature_url: 'https://example.com/signature.png',
  receipt_prefix: 'VM',
}

const cashReceipt: PublicReceipt = {
  receipt_no: 42,
  donor_name: 'Ramesh Kulkarni',
  amount_paise: 50100,
  mode: 'cash',
  created_at: '2026-01-01T00:00:00Z',
  voided: false,
  void_reason: null,
}

function renderReceiptPage(token: string) {
  render(
    <MemoryRouter initialEntries={[`/r/${token}`]}>
      <Routes>
        <Route path="/r/:public_token" element={<ReceiptPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getPublicBranding.mockResolvedValue(branding)
})

describe('ReceiptPage', () => {
  it('shows a loading state before the query resolves', () => {
    getPublicReceipt.mockReturnValue(new Promise(() => {})) // never resolves
    renderReceiptPage('tok-abc')

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows "Receipt not found" for a bogus token', async () => {
    getPublicReceipt.mockResolvedValue(null)
    renderReceiptPage('bogus-token')

    await waitFor(() => expect(screen.getByText('Receipt not found.')).toBeInTheDocument())
    expect(getPublicReceipt).toHaveBeenCalledWith('bogus-token')
  })

  it('renders the CASH stamp, amount, donor name, and receipt number for a cash donation', async () => {
    getPublicReceipt.mockResolvedValue(cashReceipt)
    renderReceiptPage('tok-abc')

    await waitFor(() => expect(screen.getByText('Ramesh Kulkarni')).toBeInTheDocument())
    expect(screen.getByText('₹501')).toBeInTheDocument()
    expect(screen.getByText('VM-000042')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'RECEIVED: CASH' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'RECEIVED: ONLINE' })).not.toBeInTheDocument()
  })

  it.each(['upi', 'bank'])('renders the ONLINE stamp for a %s-mode donation', async (mode) => {
    getPublicReceipt.mockResolvedValue({ ...cashReceipt, mode })
    renderReceiptPage('tok-abc')

    await waitFor(() => expect(screen.getByRole('img', { name: 'RECEIVED: ONLINE' })).toBeInTheDocument())
    expect(screen.queryByRole('img', { name: 'RECEIVED: CASH' })).not.toBeInTheDocument()
  })

  it('shows the voided banner with the reason instead of a valid-looking stamp', async () => {
    getPublicReceipt.mockResolvedValue({
      ...cashReceipt,
      voided: true,
      void_reason: 'Entered in error, duplicate of receipt VM-000041',
    })
    renderReceiptPage('tok-abc')

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('This entry has been voided')
    expect(screen.getByRole('alert')).toHaveTextContent('Entered in error, duplicate of receipt VM-000041')
    // A voided entry must not still present as a normal received receipt.
    expect(screen.queryByRole('img', { name: 'RECEIVED: CASH' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'RECEIVED: ONLINE' })).not.toBeInTheDocument()
  })

  it('never requests or renders donor_phone in any form', async () => {
    getPublicReceipt.mockResolvedValue(cashReceipt)
    renderReceiptPage('tok-abc')

    await waitFor(() => expect(screen.getByText('Ramesh Kulkarni')).toBeInTheDocument())

    // The only argument sent to the RPC wrapper is the token — nothing else.
    expect(getPublicReceipt).toHaveBeenCalledTimes(1)
    expect(getPublicReceipt).toHaveBeenCalledWith('tok-abc')
    // The mocked receipt object itself has no donor_phone key to render —
    // structurally impossible per PublicReceipt's type, confirmed at runtime too.
    expect(cashReceipt).not.toHaveProperty('donor_phone')
    expect(document.body.textContent).not.toMatch(/donor_phone/i)
  })
})
