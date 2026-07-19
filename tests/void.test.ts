import { describe, it, expect, vi, beforeEach } from 'vitest'
import { voidRow, clearAllDonations, purgeDonations } from '../src/lib/db/void'

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))

vi.mock('../src/lib/db/client', () => ({
  supabase: { from, rpc },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('voidRow', () => {
  it.each(['donations', 'expenses', 'handovers'] as const)(
    'calls the void_row rpc with target_table/row_id/reason on %s (voided_by/voided_at stamped server-side)',
    async (table) => {
      rpc.mockResolvedValue({ error: null })

      await voidRow(table, 'row-1', 'Wrong entry')

      expect(rpc).toHaveBeenCalledWith('void_row', {
        target_table: table,
        row_id: 'row-1',
        reason: 'Wrong entry',
      })
      // The client never touches .from(table).update(...) anymore — voiding
      // is not a plain UPDATE the client could forge void metadata through.
      expect(from).not.toHaveBeenCalled()
    },
  )

  it('throws when the rpc errors (e.g. not yours to void)', async () => {
    rpc.mockResolvedValue({ error: new Error('permission denied') })

    await expect(voidRow('expenses', 'row-1', 'reason')).rejects.toThrow('permission denied')
  })
})

describe('clearAllDonations', () => {
  it('calls the clear_donation_history rpc with the reason and returns the cleared count', async () => {
    rpc.mockResolvedValue({ data: 5, error: null })

    const cleared = await clearAllDonations('Clearing test data')

    expect(rpc).toHaveBeenCalledWith('clear_donation_history', { reason: 'Clearing test data' })
    expect(cleared).toBe(5)
  })

  it('throws when the rpc errors (e.g. a volunteer without permission)', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('only an admin can clear the donation history') })

    await expect(clearAllDonations('x')).rejects.toThrow('only an admin')
  })
})

describe('purgeDonations', () => {
  it.each(['removed', 'all'] as const)(
    'calls the purge_donations rpc with the %s scope and returns how many rows were deleted',
    async (scope) => {
      rpc.mockResolvedValue({ data: 3, error: null })

      const purged = await purgeDonations(scope)

      expect(rpc).toHaveBeenCalledWith('purge_donations', { scope })
      expect(purged).toBe(3)
      // Purge is the definer RPC's job only — never a client-side DELETE.
      expect(from).not.toHaveBeenCalled()
    },
  )

  it('throws when the rpc errors (e.g. a volunteer or wrong-mandal admin)', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('only an admin can purge donation history') })

    await expect(purgeDonations('all')).rejects.toThrow('only an admin')
  })
})
