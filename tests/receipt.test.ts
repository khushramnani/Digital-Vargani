import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPublicReceipt, getPublicBranding } from '../src/lib/db/receipt'
import type { Tables } from '../src/lib/db/database.types'

// No live Supabase project exists (same constraint as every prior task's
// tests) — mock the client's `rpc`/`from` calls directly to prove
// receipt.ts builds the right query shape, and in particular that the RPC
// call sends *only* the token — never a donor_phone (there's no such
// field to send in the first place: get_public_receipt's Returns type,
// asserted against below, has no donor_phone member at all).
const { rpc, from, maybeSingle } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('../src/lib/db/client', () => ({
  supabase: { rpc, from },
}))

beforeEach(() => {
  vi.clearAllMocks()
  from.mockReturnValue({ select: () => ({ maybeSingle }) })
})

describe('getPublicReceipt', () => {
  it('calls get_public_receipt with only the token — no donor_phone in the request', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          receipt_no: 42,
          donor_name: 'Ramesh Kulkarni',
          amount_paise: 50100,
          mode: 'cash',
          created_at: '2026-01-01T00:00:00Z',
          voided: false,
          void_reason: null,
        },
      ],
      error: null,
    })

    const result = await getPublicReceipt('tok-abc')

    expect(rpc).toHaveBeenCalledWith('get_public_receipt', { token: 'tok-abc' })
    expect(rpc.mock.calls[0][1]).toEqual({ token: 'tok-abc' }) // exact args, nothing else smuggled in
    expect(result?.donor_name).toBe('Ramesh Kulkarni')
    expect(result).not.toHaveProperty('donor_phone')
    expect(Object.keys(result ?? {})).not.toContain('donor_phone')
  })

  it('returns null for a bogus token (zero rows) rather than throwing', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    const result = await getPublicReceipt('bogus-token')

    expect(result).toBeNull()
  })

  it('throws when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('boom') })

    await expect(getPublicReceipt('tok-abc')).rejects.toThrow('boom')
  })
})

describe('getPublicBranding', () => {
  const brandingRow: Tables<'public_mandal_branding'> = {
    name: 'Vinayak Mitra Mandal',
    logo_url: 'https://example.com/logo.png',
    signature_url: 'https://example.com/signature.png',
    receipt_prefix: 'VM',
  }

  it('selects from the public_mandal_branding view', async () => {
    maybeSingle.mockResolvedValue({ data: brandingRow, error: null })

    const result = await getPublicBranding()

    expect(from).toHaveBeenCalledWith('public_mandal_branding')
    expect(result).toEqual(brandingRow)
  })

  it('throws when the query errors', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: new Error('boom') })

    await expect(getPublicBranding()).rejects.toThrow('boom')
  })
})
