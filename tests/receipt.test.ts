import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPublicReceipt, parseInquiryContacts } from '../src/lib/db/receipt'

// No live Supabase project exists (same constraint as every prior task's
// tests) — mock the client's `rpc` call directly to prove receipt.ts builds
// the right query shape, and in particular that the RPC call sends *only*
// the token — never a donor_phone (there's no such field to send in the
// first place: get_public_receipt's Returns type, asserted against below,
// has no donor_phone member at all).
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../src/lib/db/client', () => ({
  supabase: { rpc },
}))

beforeEach(() => {
  vi.clearAllMocks()
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
          mandal_name: 'Vinayak Mitra Mandal',
          logo_url: null,
          signature_url: 'https://example.com/signature.png',
          receipt_prefix: 'VM',
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

  // Branding arrives joined from the receipt's own mandal — the
  // public_mandal_branding view (a view over "the one row") is gone, so
  // there is no second call that could return a different mandal's logo.
  it('returns the branding of the receipt own mandal alongside it', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          receipt_no: 7,
          donor_name: 'Donor Name',
          amount_paise: 50000,
          mode: 'cash',
          created_at: '2026-01-01T00:00:00Z',
          voided: false,
          void_reason: null,
          mandal_name: 'Ganesh Seva Mandal',
          logo_url: 'https://example.com/gs-logo.png',
          signature_url: null,
          receipt_prefix: 'GS',
        },
      ],
      error: null,
    })

    const result = await getPublicReceipt('tok-gs')

    expect(result?.mandal_name).toBe('Ganesh Seva Mandal')
    expect(result?.receipt_prefix).toBe('GS')
    expect(result?.logo_url).toBe('https://example.com/gs-logo.png')
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

describe('parseInquiryContacts', () => {
  it('keeps well-formed {name, phone} entries', () => {
    expect(
      parseInquiryContacts([
        { name: 'Suresh Patil', phone: '9000000002' },
        { name: 'Anita Joshi', phone: '9000000003' },
      ]),
    ).toEqual([
      { name: 'Suresh Patil', phone: '9000000002' },
      { name: 'Anita Joshi', phone: '9000000003' },
    ])
  })

  it('drops malformed entries and non-array input rather than throwing', () => {
    expect(parseInquiryContacts(null)).toEqual([])
    expect(parseInquiryContacts('nope')).toEqual([])
    expect(
      parseInquiryContacts([{ name: 'No Phone' }, { phone: '999' }, 'x', null, { name: 'Ok', phone: '123' }]),
    ).toEqual([{ name: 'Ok', phone: '123' }])
  })
})
