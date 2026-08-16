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

const rowsOf = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => liteRow(offset + i))

// Builds a chain whose .range() resolves each successive page in turn, every
// page carrying the same exact `count` the way PostgREST does.
function mockPages(pages: unknown[][], count: number) {
  const range = vi.fn()
  for (const p of pages) range.mockResolvedValueOnce({ data: p, error: null, count })
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
  it('selects only the lite columns (with an exact count), oldest-first, in one page when under the page size', async () => {
    const rows = rowsOf(2)
    const { select, order1, order2, range } = mockPages([rows], 2)

    const result = await getDonationsLite()

    expect(from).toHaveBeenCalledWith('donations')
    expect(select).toHaveBeenCalledWith(
      'amount_paise, mode, category, collected_by, created_at, voided, donor_name, donor_phone, receipt_no',
      { count: 'exact' },
    )
    // Stable paging order under concurrent appends: created_at asc, id tiebreak.
    expect(order1).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(order2).toHaveBeenCalledWith('id', { ascending: true })
    expect(range).toHaveBeenCalledTimes(1)
    expect(range).toHaveBeenCalledWith(0, LITE_PAGE - 1)
    expect(result).toEqual(rows)
  })

  it('keeps paging past the PostgREST row cap until every counted row is in, so totals never undercount', async () => {
    const page1 = rowsOf(LITE_PAGE)
    const page2 = rowsOf(2, LITE_PAGE)
    const { range } = mockPages([page1, page2], LITE_PAGE + 2)

    const result = await getDonationsLite()

    expect(range).toHaveBeenCalledTimes(2)
    expect(range).toHaveBeenNthCalledWith(1, 0, LITE_PAGE - 1)
    expect(range).toHaveBeenNthCalledWith(2, LITE_PAGE, 2 * LITE_PAGE - 1)
    expect(result).toHaveLength(LITE_PAGE + 2)
    expect(result[LITE_PAGE + 1]).toEqual(page2[1])
  })

  it('stops after exactly one page when the count is an exact multiple of the page size', async () => {
    const { range } = mockPages([rowsOf(LITE_PAGE)], LITE_PAGE)

    const result = await getDonationsLite()

    expect(range).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(LITE_PAGE)
  })

  it('advances by the rows actually returned, so a lowered server Max-rows just means more pages', async () => {
    // Server hands back 3 per request even though we ask for LITE_PAGE.
    const { range } = mockPages([rowsOf(3), rowsOf(3, 3), rowsOf(1, 6)], 7)

    const result = await getDonationsLite()

    expect(range).toHaveBeenNthCalledWith(2, 3, 3 + LITE_PAGE - 1)
    expect(range).toHaveBeenNthCalledWith(3, 6, 6 + LITE_PAGE - 1)
    expect(result).toHaveLength(7)
    expect(result.map((r) => r.receipt_no)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('stops on an empty page even if the count says more (rows purged mid-fetch), and treats null data as empty', async () => {
    const { range } = mockPages([rowsOf(2), []], 5)
    expect(await getDonationsLite()).toHaveLength(2)
    expect(range).toHaveBeenCalledTimes(2)

    const range2 = vi.fn().mockResolvedValue({ data: null, error: null, count: 0 })
    from.mockReturnValue({ select: () => ({ order: () => ({ order: () => ({ range: range2 }) }) }) })
    expect(await getDonationsLite()).toEqual([])
    expect(range2).toHaveBeenCalledTimes(1)
  })

  it('keeps paging to an empty page when no count came back, rather than stopping after page one', async () => {
    const range = vi.fn()
    range.mockResolvedValueOnce({ data: rowsOf(LITE_PAGE), error: null, count: null })
    range.mockResolvedValueOnce({ data: rowsOf(1, LITE_PAGE), error: null, count: null })
    range.mockResolvedValueOnce({ data: [], error: null, count: null })
    from.mockReturnValue({ select: () => ({ order: () => ({ order: () => ({ range }) }) }) })

    expect(await getDonationsLite()).toHaveLength(LITE_PAGE + 1)
    expect(range).toHaveBeenCalledTimes(3)
  })

  it('throws the Supabase error instead of returning a partial list', async () => {
    const range = vi.fn().mockResolvedValue({ data: null, error: new Error('rls says no'), count: null })
    from.mockReturnValue({ select: () => ({ order: () => ({ order: () => ({ range }) }) }) })

    await expect(getDonationsLite()).rejects.toThrow('rls says no')
  })
})
