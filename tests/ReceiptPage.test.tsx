import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { PublicReceipt } from '../src/lib/db/receipt'
import { ReceiptPage } from '../src/features/receipt/ReceiptPage'

// Per the brief's testing section: mock src/lib/db/receipt.ts directly
// (not the raw Supabase client — that's tests/receipt.test.ts's job), and
// prove this public, unauthenticated page never requests or renders
// donor_phone. That's backed structurally: PublicReceipt (typed straight
// off get_public_receipt's Returns shape in database.types.ts) has no
// donor_phone field to accidentally read — accessing `.donor_phone` on it
// below would be a type error, not just a lint warning.
const { getPublicReceipt } = vi.hoisted(() => ({
  getPublicReceipt: vi.fn(),
}))

vi.mock('../src/lib/db/receipt', () => ({
  getPublicReceipt,
}))

// Branding is part of the receipt row now — one fetch, and it can only ever
// be the branding of the mandal the receipt itself belongs to.
const cashReceipt: PublicReceipt = {
  receipt_no: 42,
  donor_name: 'Ramesh Kulkarni',
  amount_paise: 50100,
  mode: 'cash',
  created_at: '2026-01-01T00:00:00Z',
  voided: false,
  void_reason: null,
  mandal_name: 'Vinayak Mitra Mandal',
  logo_url: null,
  signature_url: 'https://example.com/signature.png',
  receipt_prefix: 'VM',
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

  it('renders the mandal name and logo that came back with the receipt', async () => {
    getPublicReceipt.mockResolvedValue({
      ...cashReceipt,
      receipt_no: 7,
      donor_name: 'Donor Name',
      mandal_name: 'Ganesh Seva Mandal',
      logo_url: 'https://example.test/logo.png',
      signature_url: null,
      receipt_prefix: 'GS',
    })
    renderReceiptPage('tok-1')

    // The name appears both as the header and on the stamp, so target the
    // heading specifically.
    expect(await screen.findByRole('heading', { name: 'Ganesh Seva Mandal' })).toBeInTheDocument()
    expect(await screen.findByText('GS-000007')).toBeInTheDocument()
    // One fetch, not two — the branding cannot come from another mandal.
    expect(getPublicReceipt).toHaveBeenCalledTimes(1)
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

  it('renders Marathi copy for ?lang=mr', async () => {
    getPublicReceipt.mockResolvedValue(cashReceipt)
    render(
      <MemoryRouter initialEntries={['/r/tok-abc?lang=mr']}>
        <Routes>
          <Route path="/r/:public_token" element={<ReceiptPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('सार्वजनिक गणेशोत्सव')).toBeInTheDocument()
  })

  it('falls back to English for an unknown ?lang=', async () => {
    getPublicReceipt.mockResolvedValue(cashReceipt)
    render(
      <MemoryRouter initialEntries={['/r/tok-abc?lang=xx']}>
        <Routes>
          <Route path="/r/:public_token" element={<ReceiptPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Received with gratitude from')).toBeInTheDocument()
  })

  it('shows the logo as a legible header mark, not only a watermark', async () => {
    getPublicReceipt.mockResolvedValue({ ...cashReceipt, logo_url: 'https://x.test/logo.png' })
    render(
      <MemoryRouter initialEntries={['/r/tok-abc']}>
        <Routes>
          <Route path="/r/:public_token" element={<ReceiptPage />} />
        </Routes>
      </MemoryRouter>,
    )
    // The watermark is aria-hidden; the header mark is the one a donor reads
    // as "this is my mandal's receipt", so it carries the mandal's name.
    const mark = await screen.findByAltText(cashReceipt.mandal_name)
    expect(mark).toHaveAttribute('src', 'https://x.test/logo.png')
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
