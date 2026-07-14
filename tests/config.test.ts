import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getMandalConfig, updateMandalConfig, uploadMandalAsset } from '../src/lib/db/config'
import type { Tables } from '../src/lib/db/database.types'

// No live Supabase project exists (same constraint as every prior task's
// tests) — mock the client's `from`/`storage.from` chains directly to
// prove config.ts builds the right query/upload shape.
const { from, upload, getPublicUrl, storageFrom } = vi.hoisted(() => ({
  from: vi.fn(),
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
  storageFrom: vi.fn(),
}))

vi.mock('../src/lib/db/client', () => ({
  supabase: {
    from,
    storage: { from: storageFrom },
  },
}))

const configRow: Tables<'mandal_config'> = {
  id: true,
  name: 'Vinayak Mitra Mandal',
  logo_url: null,
  signature_url: null,
  upi_vpa: null,
  upi_qr_url: null,
  receipt_prefix: 'VM',
  expense_categories: ['Misc'],
  bank_opening_paise: 500000,
}

beforeEach(() => {
  vi.clearAllMocks()
  storageFrom.mockReturnValue({ upload, getPublicUrl })
})

describe('getMandalConfig', () => {
  it('selects the single mandal_config row', async () => {
    const single = vi.fn(() => Promise.resolve({ data: configRow, error: null }))
    from.mockReturnValue({ select: () => ({ single }) })

    const result = await getMandalConfig()

    expect(from).toHaveBeenCalledWith('mandal_config')
    expect(result).toEqual(configRow)
  })

  it('throws when the query errors', async () => {
    const single = vi.fn(() => Promise.resolve({ data: null, error: new Error('boom') }))
    from.mockReturnValue({ select: () => ({ single }) })

    await expect(getMandalConfig()).rejects.toThrow('boom')
  })
})

describe('updateMandalConfig', () => {
  it('updates mandal_config filtered by the id=true single-row key', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ eq }))
    from.mockReturnValue({ update })

    await updateMandalConfig({ name: 'New Name', bank_opening_paise: 500000 })

    expect(from).toHaveBeenCalledWith('mandal_config')
    expect(update).toHaveBeenCalledWith({ name: 'New Name', bank_opening_paise: 500000 })
    expect(eq).toHaveBeenCalledWith('id', true)
  })

  it('throws when the update errors (e.g. RLS rejects a non-admin)', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: new Error('permission denied') }))
    from.mockReturnValue({ update: () => ({ eq }) })

    await expect(updateMandalConfig({ name: 'x' })).rejects.toThrow('permission denied')
  })
})

describe('uploadMandalAsset', () => {
  it('uploads to a kind-prefixed path in the mandal-assets bucket and returns the public URL', async () => {
    upload.mockResolvedValue({ data: { path: 'logo-123.png' }, error: null })
    getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://example.com/mandal-assets/logo-123.png' } })
    const file = new File(['x'], 'logo.png', { type: 'image/png' })

    const url = await uploadMandalAsset('logo', file)

    expect(storageFrom).toHaveBeenCalledWith('mandal-assets')
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^logo-\d+\.png$/), file, { upsert: true })
    expect(url).toBe('https://example.com/mandal-assets/logo-123.png')
  })

  it('falls back to a generic extension when the filename has none', async () => {
    upload.mockResolvedValue({ data: {}, error: null })
    getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://example.com/mandal-assets/signature-1' } })
    const file = new File(['x'], 'signature', { type: 'image/png' })

    await uploadMandalAsset('signature', file)

    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^signature-\d+\.bin$/), file, { upsert: true })
  })

  it('throws when the upload errors, without calling getPublicUrl', async () => {
    upload.mockResolvedValue({ data: null, error: new Error('upload failed') })
    const file = new File(['x'], 'qr.png')

    await expect(uploadMandalAsset('upi_qr', file)).rejects.toThrow('upload failed')
    expect(getPublicUrl).not.toHaveBeenCalled()
  })
})
