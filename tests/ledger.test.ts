import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchLedgerRows, LEDGER_PAGE } from '../src/lib/db/ledger'

// Same convention as tests/donations.test.ts: mock the client's `from` chain to
// prove the query shape, not a live project.
const { from } = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('../src/lib/db/client', () => ({ supabase: { from } }))

type Page = { data: unknown[]; count: number }

// Each table gets its own scripted sequence of pages, keyed by table name, so
// the three concurrent fetches can't consume each other's responses.
function mockTables(pages: Record<string, Page[]>) {
  const ranges: Record<string, [number, number][]> = { donations: [], expenses: [], handovers: [] }
  from.mockImplementation((table: string) => ({
    select: (columns: string) => ({
      order: () => ({
        range: (start: number, end: number) => {
          ranges[table].push([start, end])
          const queue = pages[table]
          const page = queue.shift() ?? { data: [], count: 0 }
          return Promise.resolve({ data: page.data, error: null, count: page.count, columns })
        },
      }),
    }),
  }))
  return ranges
}

const donationRow = (i: number) => ({ amount_paise: 100 + i, mode: 'cash', collected_by: 'v-1', voided: false })
const rowsOf = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => donationRow(offset + i))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchLedgerRows', () => {
  it('maps each table into the reconciliation core shape', async () => {
    mockTables({
      donations: [{ data: [{ amount_paise: 500, mode: 'upi', collected_by: 'v-1', voided: false }], count: 1 }],
      expenses: [{ data: [{ amount_paise: 300, paid_from: 'bank', paid_by: 'a-1', voided: true }], count: 1 }],
      handovers: [{ data: [{ amount_paise: 200, volunteer_id: 'v-1', received_by: 'a-1', voided: false }], count: 1 }],
    })

    const ledger = await fetchLedgerRows()

    expect(ledger.donations).toEqual([{ amountPaise: 500, mode: 'upi', collectedBy: 'v-1', voided: false }])
    expect(ledger.expenses).toEqual([{ amountPaise: 300, paidFrom: 'bank', paidBy: 'a-1', voided: true }])
    expect(ledger.handovers).toEqual([{ amountPaise: 200, volunteerId: 'v-1', receivedBy: 'a-1', voided: false }])
  })

  // The reason this paging exists: a silent 1000-row cap would understate every
  // reconcile total and make booksBalanceCheck report a discrepancy that only
  // exists because rows never arrived.
  it('keeps paging past the PostgREST row cap until every counted row is in', async () => {
    const ranges = mockTables({
      donations: [
        { data: rowsOf(LEDGER_PAGE), count: LEDGER_PAGE + 3 },
        { data: rowsOf(3, LEDGER_PAGE), count: LEDGER_PAGE + 3 },
      ],
      expenses: [{ data: [], count: 0 }],
      handovers: [{ data: [], count: 0 }],
    })

    const ledger = await fetchLedgerRows()

    expect(ledger.donations).toHaveLength(LEDGER_PAGE + 3)
    expect(ranges.donations).toEqual([
      [0, LEDGER_PAGE - 1],
      [LEDGER_PAGE, LEDGER_PAGE * 2 - 1],
    ])
  })

  it('stops on an empty page, so rows purged mid-fetch cannot make it spin', async () => {
    const ranges = mockTables({
      // A count that will never be reached because the rows went away.
      donations: [{ data: rowsOf(2), count: 99 }, { data: [], count: 99 }],
      expenses: [{ data: [], count: 0 }],
      handovers: [{ data: [], count: 0 }],
    })

    const ledger = await fetchLedgerRows()

    expect(ledger.donations).toHaveLength(2)
    expect(ranges.donations).toHaveLength(2)
  })

  it('does not end early when no count reaches the client', async () => {
    const ranges = mockTables({
      donations: [
        { data: rowsOf(LEDGER_PAGE), count: null as unknown as number },
        { data: [], count: null as unknown as number },
      ],
      expenses: [{ data: [], count: 0 }],
      handovers: [{ data: [], count: 0 }],
    })

    const ledger = await fetchLedgerRows()

    expect(ledger.donations).toHaveLength(LEDGER_PAGE)
    expect(ranges.donations).toHaveLength(2)
  })

  it('surfaces a query error rather than returning a short ledger', async () => {
    from.mockImplementation(() => ({
      select: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: new Error('rls'), count: null }) }) }),
    }))

    await expect(fetchLedgerRows()).rejects.toThrow('rls')
  })
})
