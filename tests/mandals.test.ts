import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMandal } from '../src/lib/db/mandals'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../src/lib/db/client', () => ({ supabase: { rpc } }))

beforeEach(() => vi.clearAllMocks())

describe('createMandal', () => {
  it('calls the create_mandal RPC and returns the new mandal id', async () => {
    rpc.mockResolvedValue({ data: '11111111-1111-1111-1111-000000000001', error: null })

    const id = await createMandal('Shivaji Nagar Mandal', 'New Founder', {
      slugHint: 'shivaji-nagar',
      state: 'Maharashtra',
    })

    expect(rpc).toHaveBeenCalledWith('create_mandal', {
      mandal_name: 'Shivaji Nagar Mandal',
      admin_name: 'New Founder',
      slug_hint: 'shivaji-nagar',
      mandal_state: 'Maharashtra',
      mandal_address: undefined,
    })
    expect(id).toBe('11111111-1111-1111-1111-000000000001')
  })

  // '' would be slugified to '' server-side and then fall through the same
  // coalesce as null — but only undefined lets the RPC's `default null`
  // apply, so the wrapper must not turn a blank field into an empty string.
  it('sends undefined, not an empty string, for blank optional fields', async () => {
    rpc.mockResolvedValue({ data: '11111111-1111-1111-1111-000000000001', error: null })

    await createMandal('Shivaji Nagar Mandal', 'New Founder')

    expect(rpc).toHaveBeenCalledWith('create_mandal', {
      mandal_name: 'Shivaji Nagar Mandal',
      admin_name: 'New Founder',
      slug_hint: undefined,
      mandal_state: undefined,
      mandal_address: undefined,
    })
  })

  it('throws the RPC error so the caller can show the DB message verbatim', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('this account already belongs to a mandal') })

    await expect(createMandal('X', 'Y')).rejects.toThrow('this account already belongs to a mandal')
  })
})
