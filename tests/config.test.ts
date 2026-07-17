import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getMandal, getExpenseCategories, updateMandal, uploadMandalAsset } from '../src/lib/db/config'
import type { Tables } from '../src/lib/db/database.types'

// No live Supabase project exists (same constraint as every prior task's
// tests) — mock the client's `from`/`rpc`/`storage.from` chains directly to
// prove config.ts builds the right query/upload shape.
const { from, rpc, upload, getPublicUrl, storageFrom } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
  storageFrom: vi.fn(),
}))

vi.mock('../src/lib/db/client', () => ({
  supabase: {
    from,
    rpc,
    storage: { from: storageFrom },
  },
}))

const MANDAL_ID = '11111111-1111-1111-1111-000000000001'

const configRow: Tables<'mandals'> = {
  id: MANDAL_ID,
  name: 'Vinayak Mitra Mandal',
  slug: 'vinayak-mitra-mandal',
  logo_url: null,
  signature_url: null,
  upi_vpa: null,
  upi_qr_url: null,
  receipt_prefix: 'VM',
  expense_categories: ['Misc'],
  bank_opening_paise: 500000,
  transparency_published: false,
  next_receipt_no: 1,
  created_at: '2026-07-17T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  storageFrom.mockReturnValue({ upload, getPublicUrl })
})

describe('getMandal', () => {
  // No client-side tenant filter: mandals_admin_select scopes the select to
  // the caller's own mandal server-side, which is what keeps single() at
  // exactly one row.
  it('selects the caller own mandals row with no client-side filter', async () => {
    const single = vi.fn(() => Promise.resolve({ data: configRow, error: null }))
    from.mockReturnValue({ select: () => ({ single }) })

    const result = await getMandal()

    expect(from).toHaveBeenCalledWith('mandals')
    expect(result).toEqual(configRow)
  })

  it('throws when the query errors', async () => {
    const single = vi.fn(() => Promise.resolve({ data: null, error: new Error('boom') }))
    from.mockReturnValue({ select: () => ({ single }) })

    await expect(getMandal()).rejects.toThrow('boom')
  })
})

describe('getExpenseCategories', () => {
  it('calls the get_expense_categories RPC (readable by a volunteer session, unlike mandals directly)', async () => {
    rpc.mockResolvedValue({ data: ['Mandap', 'Prasad'], error: null })

    const result = await getExpenseCategories()

    expect(rpc).toHaveBeenCalledWith('get_expense_categories')
    expect(result).toEqual(['Mandap', 'Prasad'])
  })

  it('returns an empty array (not null) when the RPC returns null', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    expect(await getExpenseCategories()).toEqual([])
  })

  it('throws when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('permission denied') })

    await expect(getExpenseCategories()).rejects.toThrow('permission denied')
  })
})

describe('updateMandal', () => {
  it('updates mandals filtered by the passed id', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ eq }))
    from.mockReturnValue({ update })

    await updateMandal(MANDAL_ID, { name: 'New Name', bank_opening_paise: 500000 })

    expect(from).toHaveBeenCalledWith('mandals')
    expect(update).toHaveBeenCalledWith({ name: 'New Name', bank_opening_paise: 500000 })
    expect(eq).toHaveBeenCalledWith('id', MANDAL_ID)
  })

  it('throws when the update errors (e.g. RLS rejects a non-admin or another mandal id)', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: new Error('permission denied') }))
    from.mockReturnValue({ update: () => ({ eq }) })

    await expect(updateMandal(MANDAL_ID, { name: 'x' })).rejects.toThrow('permission denied')
  })
})

describe('uploadMandalAsset', () => {
  // The mandal id must lead the path: mandal_assets_admin_write checks
  // (storage.foldername(name))[1] against app_mandal_id(), so a flat path
  // is rejected server-side outright.
  it('uploads under a <mandal_id>/ prefix in the mandal-assets bucket and returns the public URL', async () => {
    upload.mockResolvedValue({ data: { path: `${MANDAL_ID}/logo-123.png` }, error: null })
    getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://example.com/mandal-assets/logo-123.png' } })
    const file = new File(['x'], 'logo.png', { type: 'image/png' })

    const url = await uploadMandalAsset(MANDAL_ID, 'logo', file)

    expect(storageFrom).toHaveBeenCalledWith('mandal-assets')
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${MANDAL_ID}/logo-\\d+\\.png$`)), file, {
      upsert: true,
    })
    expect(url).toBe('https://example.com/mandal-assets/logo-123.png')
  })

  it('falls back to a generic extension when the filename has none', async () => {
    upload.mockResolvedValue({ data: {}, error: null })
    getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://example.com/mandal-assets/signature-1' } })
    const file = new File(['x'], 'signature', { type: 'image/png' })

    await uploadMandalAsset(MANDAL_ID, 'signature', file)

    expect(upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${MANDAL_ID}/signature-\\d+\\.bin$`)), file, {
      upsert: true,
    })
  })

  it('throws when the upload errors, without calling getPublicUrl', async () => {
    upload.mockResolvedValue({ data: null, error: new Error('upload failed') })
    const file = new File(['x'], 'qr.png')

    await expect(uploadMandalAsset(MANDAL_ID, 'upi_qr', file)).rejects.toThrow('upload failed')
    expect(getPublicUrl).not.toHaveBeenCalled()
  })
})
