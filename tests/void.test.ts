import { describe, it, expect, vi, beforeEach } from 'vitest'
import { voidRow } from '../src/lib/db/void'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('../src/lib/db/client', () => ({
  supabase: { from },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('voidRow', () => {
  it.each(['donations', 'expenses', 'handovers'] as const)(
    'sets exactly voided/void_reason/voided_by/voided_at on %s, filtered by id',
    async (table) => {
      const eq = vi.fn(() => Promise.resolve({ error: null }))
      const update = vi.fn(() => ({ eq }))
      from.mockReturnValue({ update })

      await voidRow(table, 'row-1', 'Wrong entry', 'admin-1')

      expect(from).toHaveBeenCalledWith(table)
      expect(update).toHaveBeenCalledWith({
        voided: true,
        void_reason: 'Wrong entry',
        voided_by: 'admin-1',
        voided_at: expect.any(String),
      })
      expect(eq).toHaveBeenCalledWith('id', 'row-1')
    },
  )

  it('throws when the update errors', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: new Error('permission denied') }))
    from.mockReturnValue({ update: () => ({ eq }) })

    await expect(voidRow('expenses', 'row-1', 'reason', 'admin-1')).rejects.toThrow('permission denied')
  })
})
