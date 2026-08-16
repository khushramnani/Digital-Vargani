import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getDonationsLite, LITE_PAGE } from '../src/lib/db/donations'

// Same convention as tests/expenses.test.ts: mock the client's `from` chain to
// prove the query shape, not a live project.
const { from } = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('../src/lib/db/client', () => ({
  supabase: { from },
}))

const liteRow = (i: number) => ({
  amount_paise: 100 + i,
  mode: 'cash',
  category: 'society',
  collected_by: 'v-1',
  created_at: '2026-08-16T04:30:00Z',
  voided: false,
  donor_name: `Donor ${i}`,
  donor_phone: null,
  receipt_no: i + 1,
})

// Builds a chain whose .range() resolves each successive page in turn.
function mockPages(pages: unknown[][]) {
  const range = vi.fn()
  for (const p of pages) range.mockResolvedValueOnce({ data: p, error: null })
  const order2 = vi.fn(() => ({ range }))
  const order1 = vi.fn(() => ({ order: order2 }))
  const select = vi.fn(() => ({ order: order1 }))
  from.mockReturnValue({ select })
  return { select, order1, order2, range }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getDonationsLite', () => {
  it('selects only the lite columns, oldest-first, in one page when under the page size', async () => {
    const rows = [liteRow(0), liteRow(1)]
    const { select, order1, order2, range } = mockPages([rows])

    const result = await getDonationsLite()

    expect(from).toHaveBeenCalledWith('donations')
    expect(select).toHaveBeenCalledWith(
      'amount_paise, mode, category, collected_by, created_at, voided, donor_name, donor_phone, receipt_no',
    )
    // Stable paging order under concurrent appends: created_at asc, id tiebreak.
    expect(order1).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(order2).toHaveBeenCalledWith('id', { ascending: true })
    expect(range).toHaveBeenCalledTimes(1)
    expect(range).toHaveBeenCalledWith(0, LITE_PAGE - 1)
    expect(result).toEqual(rows)
  })

  it('keeps paging past the PostgREST row cap until a short page, so totals never undercount', async () => {
    const page1 = Array.from({ length: LITE_PAGE }, (_, i) => liteRow(i))
    const page2 = [liteRow(LITE_PAGE), liteRow(LITE_PAGE + 1)]
    const { range } = mockPages([page1, page2])

    const result = await getDonationsLite()

    expect(range).toHaveBeenCalledTimes(2)
    expect(range).toHaveBeenNthCalledWith(1, 0, LITE_PAGE - 1)
    expect(range).toHaveBeenNthCalledWith(2, LITE_PAGE, 2 * LITE_PAGE - 1)
    expect(result).toHaveLength(LITE_PAGE + 2)
    expect(result[LITE_PAGE + 1]).toEqual(page2[1])
  })

  it('throws the Supabase error instead of returning a partial list', async () => {
    const range = vi.fn().mockResolvedValue({ data: null, error: new Error('rls says no') })
    from.mockReturnValue({ select: () => ({ order: () => ({ order: () => ({ range }) }) }) })

    await expect(getDonationsLite()).rejects.toThrow('rls says no')
  })
})
