import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Tables } from '../src/lib/db/database.types'
import { strings } from '../src/lib/strings'
import { AdminTransparencyContent } from '../src/features/transparency/AdminTransparency'

// The publish toggle now heads the content body (AdminLayout owns the console
// frame), so the body renders bare here. No useAuth needed — the content
// component reads no session.

function renderScreen() {
  return render(
    <MemoryRouter>
      <AdminTransparencyContent />
    </MemoryRouter>,
  )
}

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
  donation_sources: ['Society', 'Shop', 'Other'],
  expense_categories: ['Mandap'],
  bank_opening_paise: 0,
  transparency_published: false,
  transparency_visibility: 'public',
  city: null,
  president_name: null,
  inquiry_contacts: [],
  hide_president_contact: false,
  default_lang: 'en',
  next_receipt_no: 1,
  created_at: '2026-07-17T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  getMandal.mockResolvedValue(config)
  getTransparencyReport.mockResolvedValue({ totalCollectedPaise: 100000, totalExpensesPaise: 0, donorCount: 3 })
  getTransparencyCategories.mockResolvedValue([])
  updateMandal.mockResolvedValue(undefined)
})

describe('AdminTransparency', () => {
  it('previews the aggregate even when unpublished, and toggling calls updateMandal with its own id', async () => {
    renderScreen()

    await waitFor(() => expect(screen.getByText('₹1,000.00')).toBeInTheDocument())
    // The redesign states the consequence rather than the flag: until it is
    // published, only signed-in members can open the link.
    expect(screen.getByText(strings.transparency.notPublishedTitle)).toBeInTheDocument()
    expect(screen.getByText(strings.transparency.notPublishedBody)).toBeInTheDocument()
    // And the preview is labelled as one, so "exactly what they'll see" is true
    // of what is on screen.
    expect(screen.getByText(strings.transparency.previewEyebrow)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: strings.transparency.publishCta }))

    await waitFor(() => expect(updateMandal).toHaveBeenCalledWith(MANDAL_ID, { transparency_published: true }))
  })

  // The admin preview must read its OWN mandal's report — the RPCs are
  // slug-addressed now, and the migration's admin bypass is same-mandal
  // only, so passing anything but this slug returns zero rows.
  it('passes its own mandal slug to the transparency RPCs', async () => {
    renderScreen()

    await waitFor(() => expect(getTransparencyReport).toHaveBeenCalledWith('vinayak-mitra-mandal'))
    expect(getTransparencyCategories).toHaveBeenCalledWith('vinayak-mitra-mandal')
  })

  it('shows the shareable public link for its own slug', async () => {
    renderScreen()

    await waitFor(() =>
      expect(screen.getByText(`${window.location.origin}/transparency/vinayak-mitra-mandal`)).toBeInTheDocument(),
    )
  })

  // F5: the current transparency_visibility is surfaced as a read-only badge
  // (the picker itself lives in Mandal Settings).
  it('shows the current transparency visibility as a badge, and says where to change it', async () => {
    renderScreen()

    // WHO may open it is a Settings decision; WHETHER it is published is this
    // tab's. Naming both keeps the two switches from reading as one.
    await waitFor(() =>
      expect(screen.getByText(strings.transparencyVisibility.public)).toBeInTheDocument(),
    )
    expect(screen.getByText(strings.transparency.changeInSettings)).toBeInTheDocument()
  })

  it('offers a share action and an unpublish once the report is live', async () => {
    getMandal.mockResolvedValue({ ...config, transparency_published: true })
    renderScreen()

    await waitFor(() => expect(screen.getByText(strings.transparency.publishedTitle)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: strings.app.shareWhatsApp })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: strings.transparency.unpublishButton }))

    await waitFor(() => expect(updateMandal).toHaveBeenCalledWith(MANDAL_ID, { transparency_published: false }))
  })
})
