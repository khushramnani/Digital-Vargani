import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getMandal,
  getExpenseCategories,
  getMandalDefaultLang,
  updateMandal,
  uploadMandalAsset,
} from '../src/lib/db/config'
import type { Tables } from '../src/lib/db/database.types'

// No live Supabase project exists (same constraint as every prior task's
// tests) — mock the client's `from`/`rpc`/`functions.invoke` chains directly
// to prove config.ts builds the right query/upload shape.
const { from, rpc, invoke } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('../src/lib/db/client', () => ({
  supabase: {
    from,
    rpc,
    functions: { invoke },
  },
}))

const MANDAL_ID = '11111111-1111-1111-1111-000000000001'

const configRow: Tables<'mandals'> = {
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
  expense_categories: ['Misc'],
  bank_opening_paise: 500000,
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
  vi.unstubAllGlobals()
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

describe('getMandalDefaultLang', () => {
  it('calls the get_mandal_default_lang RPC', async () => {
    rpc.mockResolvedValue({ data: 'mr', error: null })
    const result = await getMandalDefaultLang()
    expect(rpc).toHaveBeenCalledWith('get_mandal_default_lang')
    expect(result).toBe('mr')
  })

  // A mandal row could hold a code this build doesn't know (rolled back
  // deploy, hand-edited row). The picker must not render a broken option.
  it('falls back to English for an unrecognised value', async () => {
    rpc.mockResolvedValue({ data: 'fr', error: null })
    expect(await getMandalDefaultLang()).toBe('en')
  })

  // Never block the collection form on this — it's a preference, not data.
  it('falls back to English when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('boom') })
    expect(await getMandalDefaultLang()).toBe('en')
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
  const file = new File(['x'], 'logo.png', { type: 'image/png' })

  it('signs via the edge function, posts to Cloudinary, and returns secure_url', async () => {
    invoke.mockResolvedValue({
      data: {
        signature: 'sig123',
        timestamp: '1700000000',
        folder: 'mandals/m1',
        api_key: 'key123',
        cloud_name: 'democloud',
      },
      error: null,
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ secure_url: 'https://res.cloudinary.com/democloud/logo.png' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const url = await uploadMandalAsset('m1', 'logo', file)

    expect(invoke).toHaveBeenCalledWith('sign-upload')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudinary.com/v1_1/democloud/image/upload',
      expect.objectContaining({ method: 'POST' }),
    )
    // The signed folder is the function's, never the caller's argument.
    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(body.get('folder')).toBe('mandals/m1')
    expect(body.get('signature')).toBe('sig123')
    expect(body.get('api_key')).toBe('key123')
    expect(url).toBe('https://res.cloudinary.com/democloud/logo.png')
  })

  it('throws when the edge function refuses (e.g. a volunteer session)', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('admin only') })
    await expect(uploadMandalAsset('m1', 'logo', file)).rejects.toThrow('admin only')
  })

  it('throws when Cloudinary rejects the upload', async () => {
    invoke.mockResolvedValue({
      data: { signature: 's', timestamp: '1', folder: 'mandals/m1', api_key: 'k', cloud_name: 'c' },
      error: null,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    await expect(uploadMandalAsset('m1', 'logo', file)).rejects.toThrow()
  })
})
