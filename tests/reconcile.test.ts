import { describe, it, expect } from 'vitest'
import {
  volunteerCashInHand,
  totalCollected,
  totalExpenses,
  netBalance,
  cashHeldByTreasurer,
  bankBalance,
  booksBalanceCheck,
  type Ledger,
} from '../src/lib/reconcile'

const emptyLedger: Ledger = {
  users: [],
  donations: [],
  expenses: [],
  handovers: [],
  bankOpeningPaise: 0,
}

describe('volunteerCashInHand', () => {
  it('is zero for an empty ledger', () => {
    expect(volunteerCashInHand('v1', emptyLedger)).toBe(0)
  })

  it('counts a single cash donation collected by the volunteer', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
      ],
    }
    expect(volunteerCashInHand('v1', ledger)).toBe(5000)
  })

  it('nets multiple cash donations, cash expenses, and handovers', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
        { amountPaise: 2000, mode: 'cash', collectedBy: 'v1', voided: false },
      ],
      expenses: [
        { amountPaise: 1000, paidFrom: 'cash', paidBy: 'v1', voided: false },
      ],
      handovers: [
        { amountPaise: 3000, volunteerId: 'v1', receivedBy: 'a1', voided: false },
      ],
    }
    // 5000 + 2000 - 1000 - 3000 = 3000
    expect(volunteerCashInHand('v1', ledger)).toBe(3000)
  })

  it('ignores non-cash donation modes', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
        { amountPaise: 2000, mode: 'upi', collectedBy: 'v1', voided: false },
        { amountPaise: 1000, mode: 'bank', collectedBy: 'v1', voided: false },
      ],
    }
    expect(volunteerCashInHand('v1', ledger)).toBe(5000)
  })

  it('ignores bank expenses (only cash paidFrom counts)', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
      ],
      expenses: [
        { amountPaise: 1000, paidFrom: 'bank', paidBy: 'v1', voided: false },
      ],
    }
    expect(volunteerCashInHand('v1', ledger)).toBe(5000)
  })

  it('excludes a voided cash donation', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: true },
      ],
    }
    expect(volunteerCashInHand('v1', ledger)).toBe(0)
  })

  it('excludes a voided cash expense', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
      ],
      expenses: [
        { amountPaise: 1000, paidFrom: 'cash', paidBy: 'v1', voided: true },
      ],
    }
    expect(volunteerCashInHand('v1', ledger)).toBe(5000)
  })

  it('excludes a voided handover', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
      ],
      handovers: [
        { amountPaise: 3000, volunteerId: 'v1', receivedBy: 'a1', voided: true },
      ],
    }
    expect(volunteerCashInHand('v1', ledger)).toBe(5000)
  })

  it('keeps independent totals per volunteer (no cross-leak)', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
        { amountPaise: 7000, mode: 'cash', collectedBy: 'v2', voided: false },
      ],
      expenses: [
        { amountPaise: 1000, paidFrom: 'cash', paidBy: 'v2', voided: false },
      ],
      handovers: [
        { amountPaise: 2000, volunteerId: 'v1', receivedBy: 'a1', voided: false },
      ],
    }
    expect(volunteerCashInHand('v1', ledger)).toBe(3000) // 5000 - 2000
    expect(volunteerCashInHand('v2', ledger)).toBe(6000) // 7000 - 1000
  })
})

describe('totalCollected', () => {
  it('is zero for an empty ledger', () => {
    expect(totalCollected(emptyLedger)).toBe(0)
  })

  it('sums a single donation', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
      ],
    }
    expect(totalCollected(ledger)).toBe(5000)
  })

  it('sums multiple donations across all modes', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
        { amountPaise: 2000, mode: 'upi', collectedBy: 'v1', voided: false },
        { amountPaise: 1000, mode: 'bank', collectedBy: 'v2', voided: false },
      ],
    }
    expect(totalCollected(ledger)).toBe(8000)
  })

  it('excludes voided donations', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
        { amountPaise: 2000, mode: 'upi', collectedBy: 'v1', voided: true },
      ],
    }
    expect(totalCollected(ledger)).toBe(5000)
  })
})

describe('totalExpenses', () => {
  it('is zero for an empty ledger', () => {
    expect(totalExpenses(emptyLedger)).toBe(0)
  })

  it('sums a single expense', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      expenses: [
        { amountPaise: 1000, paidFrom: 'cash', paidBy: 'v1', voided: false },
      ],
    }
    expect(totalExpenses(ledger)).toBe(1000)
  })

  it('sums multiple expenses across cash and bank', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      expenses: [
        { amountPaise: 1000, paidFrom: 'cash', paidBy: 'v1', voided: false },
        { amountPaise: 700, paidFrom: 'bank', paidBy: 'a1', voided: false },
      ],
    }
    expect(totalExpenses(ledger)).toBe(1700)
  })

  it('excludes voided expenses', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      expenses: [
        { amountPaise: 1000, paidFrom: 'cash', paidBy: 'v1', voided: false },
        { amountPaise: 700, paidFrom: 'bank', paidBy: 'a1', voided: true },
      ],
    }
    expect(totalExpenses(ledger)).toBe(1000)
  })
})

describe('netBalance', () => {
  it('is zero for an empty ledger', () => {
    expect(netBalance(emptyLedger)).toBe(0)
  })

  it('is totalCollected minus totalExpenses', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
        { amountPaise: 2000, mode: 'upi', collectedBy: 'v1', voided: false },
      ],
      expenses: [
        { amountPaise: 1000, paidFrom: 'cash', paidBy: 'v1', voided: false },
      ],
    }
    expect(netBalance(ledger)).toBe(6000)
  })

  it('ignores voided donations and expenses', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
        { amountPaise: 9999, mode: 'cash', collectedBy: 'v1', voided: true },
      ],
      expenses: [
        { amountPaise: 1000, paidFrom: 'cash', paidBy: 'v1', voided: false },
        { amountPaise: 500, paidFrom: 'bank', paidBy: 'a1', voided: true },
      ],
    }
    expect(netBalance(ledger)).toBe(4000)
  })
})

describe('cashHeldByTreasurer', () => {
  it('is zero for an empty ledger', () => {
    expect(cashHeldByTreasurer(emptyLedger)).toBe(0)
  })

  it('counts a single handover', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      handovers: [
        { amountPaise: 2000, volunteerId: 'v1', receivedBy: 'a1', voided: false },
      ],
    }
    expect(cashHeldByTreasurer(ledger)).toBe(2000)
  })

  it('sums multiple handovers from different volunteers', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      handovers: [
        { amountPaise: 2000, volunteerId: 'v1', receivedBy: 'a1', voided: false },
        { amountPaise: 1500, volunteerId: 'v2', receivedBy: 'a1', voided: false },
      ],
    }
    expect(cashHeldByTreasurer(ledger)).toBe(3500)
  })

  it("reduces by an admin's cash expense without touching a volunteer's cash-in-hand", () => {
    const ledger: Ledger = {
      ...emptyLedger,
      users: [
        { id: 'v1', role: 'volunteer' },
        { id: 'a1', role: 'admin' },
      ],
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
      ],
      handovers: [
        { amountPaise: 2000, volunteerId: 'v1', receivedBy: 'a1', voided: false },
      ],
      expenses: [
        { amountPaise: 500, paidFrom: 'cash', paidBy: 'a1', voided: false },
      ],
    }
    expect(cashHeldByTreasurer(ledger)).toBe(1500) // 2000 - 500
    expect(volunteerCashInHand('v1', ledger)).toBe(3000) // 5000 - 2000, admin expense untouched
  })

  it("does not net a volunteer's cash expense (only admin cash expenses count)", () => {
    const ledger: Ledger = {
      ...emptyLedger,
      users: [
        { id: 'v1', role: 'volunteer' },
        { id: 'a1', role: 'admin' },
      ],
      handovers: [
        { amountPaise: 2000, volunteerId: 'v1', receivedBy: 'a1', voided: false },
      ],
      expenses: [
        { amountPaise: 500, paidFrom: 'cash', paidBy: 'v1', voided: false },
      ],
    }
    expect(cashHeldByTreasurer(ledger)).toBe(2000)
  })

  it('ignores admin bank expenses (only cash paidFrom counts)', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      users: [{ id: 'a1', role: 'admin' }],
      handovers: [
        { amountPaise: 2000, volunteerId: 'v1', receivedBy: 'a1', voided: false },
      ],
      expenses: [
        { amountPaise: 500, paidFrom: 'bank', paidBy: 'a1', voided: false },
      ],
    }
    expect(cashHeldByTreasurer(ledger)).toBe(2000)
  })

  it('excludes a voided handover', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      handovers: [
        { amountPaise: 2000, volunteerId: 'v1', receivedBy: 'a1', voided: true },
      ],
    }
    expect(cashHeldByTreasurer(ledger)).toBe(0)
  })

  it("excludes a voided admin cash expense", () => {
    const ledger: Ledger = {
      ...emptyLedger,
      users: [{ id: 'a1', role: 'admin' }],
      handovers: [
        { amountPaise: 2000, volunteerId: 'v1', receivedBy: 'a1', voided: false },
      ],
      expenses: [
        { amountPaise: 500, paidFrom: 'cash', paidBy: 'a1', voided: true },
      ],
    }
    expect(cashHeldByTreasurer(ledger)).toBe(2000)
  })

  it("includes an admin's own cash donation (held directly, not via a handover)", () => {
    const ledger: Ledger = {
      ...emptyLedger,
      users: [
        { id: 'v1', role: 'volunteer' },
        { id: 'a1', role: 'admin' },
      ],
      donations: [
        { amountPaise: 4000, mode: 'cash', collectedBy: 'a1', voided: false },
        // a volunteer's cash is theirs until handed over — not the treasurer's
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
      ],
      handovers: [
        { amountPaise: 2000, volunteerId: 'v1', receivedBy: 'a1', voided: false },
      ],
    }
    // 2000 (handover) + 4000 (admin cash) - 0 = 6000
    expect(cashHeldByTreasurer(ledger)).toBe(6000)
    // the volunteer's own cash-in-hand is unaffected by the admin's collection
    expect(volunteerCashInHand('v1', ledger)).toBe(3000) // 5000 - 2000
  })

  it("includes an owner's own cash donation (owner is admin-tier, held directly)", () => {
    const ledger: Ledger = {
      ...emptyLedger,
      users: [
        { id: 'v1', role: 'volunteer' },
        { id: 'o1', role: 'owner' },
      ],
      donations: [
        { amountPaise: 4000, mode: 'cash', collectedBy: 'o1', voided: false },
        // a volunteer's cash is theirs until handed over — not the treasurer's
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
      ],
      handovers: [
        { amountPaise: 2000, volunteerId: 'v1', receivedBy: 'o1', voided: false },
      ],
    }
    // 2000 (handover) + 4000 (owner cash) - 0 = 6000
    expect(cashHeldByTreasurer(ledger)).toBe(6000)
    // the volunteer's own cash-in-hand is unaffected by the owner's collection
    expect(volunteerCashInHand('v1', ledger)).toBe(3000) // 5000 - 2000
  })

  it("excludes a voided admin cash donation", () => {
    const ledger: Ledger = {
      ...emptyLedger,
      users: [{ id: 'a1', role: 'admin' }],
      donations: [
        { amountPaise: 4000, mode: 'cash', collectedBy: 'a1', voided: true },
      ],
    }
    expect(cashHeldByTreasurer(ledger)).toBe(0)
  })

  it("ignores an admin's online (upi/bank) donation — only cash is held as cash", () => {
    const ledger: Ledger = {
      ...emptyLedger,
      users: [{ id: 'a1', role: 'admin' }],
      donations: [
        { amountPaise: 4000, mode: 'upi', collectedBy: 'a1', voided: false },
      ],
    }
    expect(cashHeldByTreasurer(ledger)).toBe(0)
  })
})

describe('bankBalance', () => {
  it('is bankOpeningPaise for an empty ledger', () => {
    expect(bankBalance({ ...emptyLedger, bankOpeningPaise: 10000 })).toBe(10000)
  })

  it('adds a single upi donation', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      bankOpeningPaise: 10000,
      donations: [
        { amountPaise: 2000, mode: 'upi', collectedBy: 'v1', voided: false },
      ],
    }
    expect(bankBalance(ledger)).toBe(12000)
  })

  it('adds a single bank donation', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      bankOpeningPaise: 10000,
      donations: [
        { amountPaise: 1000, mode: 'bank', collectedBy: 'v1', voided: false },
      ],
    }
    expect(bankBalance(ledger)).toBe(11000)
  })

  it('subtracts a single bank expense', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      bankOpeningPaise: 10000,
      expenses: [
        { amountPaise: 700, paidFrom: 'bank', paidBy: 'a1', voided: false },
      ],
    }
    expect(bankBalance(ledger)).toBe(9300)
  })

  it('ignores cash donations and cash expenses', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      bankOpeningPaise: 10000,
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
      ],
      expenses: [
        { amountPaise: 1000, paidFrom: 'cash', paidBy: 'v1', voided: false },
      ],
    }
    expect(bankBalance(ledger)).toBe(10000)
  })

  it('combines opening balance, upi+bank donations, and bank expenses', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      bankOpeningPaise: 10000,
      donations: [
        { amountPaise: 2000, mode: 'upi', collectedBy: 'v1', voided: false },
        { amountPaise: 1000, mode: 'bank', collectedBy: 'v2', voided: false },
      ],
      expenses: [
        { amountPaise: 700, paidFrom: 'bank', paidBy: 'a1', voided: false },
      ],
    }
    expect(bankBalance(ledger)).toBe(12300)
  })

  it('excludes a voided upi/bank donation', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      bankOpeningPaise: 10000,
      donations: [
        { amountPaise: 2000, mode: 'upi', collectedBy: 'v1', voided: true },
      ],
    }
    expect(bankBalance(ledger)).toBe(10000)
  })

  it('excludes a voided bank expense', () => {
    const ledger: Ledger = {
      ...emptyLedger,
      bankOpeningPaise: 10000,
      expenses: [
        { amountPaise: 700, paidFrom: 'bank', paidBy: 'a1', voided: true },
      ],
    }
    expect(bankBalance(ledger)).toBe(10000)
  })
})

describe('booksBalanceCheck', () => {
  it('balances (discrepancy zero) for an empty ledger', () => {
    const result = booksBalanceCheck(emptyLedger)
    expect(result).toEqual({ balanced: true, discrepancyPaise: 0 })
  })

  it('proves the books-balance identity on a hand-constructed ledger', () => {
    // Hand-built ledger exercising both volunteers, an admin, all donation
    // modes, all expense paidFrom values, a handover, and one voided row of
    // each kind (which must be excluded from every sum below).
    const ledger: Ledger = {
      users: [
        { id: 'v1', role: 'volunteer' },
        { id: 'v2', role: 'volunteer' },
        { id: 'a1', role: 'admin' },
      ],
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
        { amountPaise: 3000, mode: 'cash', collectedBy: 'v2', voided: false },
        { amountPaise: 2000, mode: 'upi', collectedBy: 'v1', voided: false },
        { amountPaise: 1000, mode: 'bank', collectedBy: 'v2', voided: false },
        // voided — must not affect any total
        { amountPaise: 9999, mode: 'cash', collectedBy: 'v1', voided: true },
      ],
      expenses: [
        { amountPaise: 1000, paidFrom: 'cash', paidBy: 'v1', voided: false },
        { amountPaise: 500, paidFrom: 'cash', paidBy: 'a1', voided: false },
        { amountPaise: 700, paidFrom: 'bank', paidBy: 'a1', voided: false },
        // voided — must not affect any total
        { amountPaise: 300, paidFrom: 'cash', paidBy: 'v1', voided: true },
      ],
      handovers: [
        { amountPaise: 2000, volunteerId: 'v1', receivedBy: 'a1', voided: false },
        // voided — must not affect any total
        { amountPaise: 1000, volunteerId: 'v1', receivedBy: 'a1', voided: true },
      ],
      bankOpeningPaise: 10000,
    }

    // Independently hand-computed (not derived by calling the production
    // functions under test), following the algebraic proof in reconcile.ts:
    //   volunteerCashInHand(v1) = 5000 (cash in) - 1000 (cash expense) - 2000 (handover) = 2000
    //   volunteerCashInHand(v2) = 3000 (cash in) - 0 - 0 = 3000
    //   sum over volunteers                                         = 5000
    //   cashHeldByTreasurer = 2000 (handovers) - 500 (admin cash expense) = 1500
    //   bankBalance = 10000 (opening) + 2000 + 1000 (upi+bank) - 700 (bank expense) = 12300
    const expectedLHS = 2000 + 3000 + 1500 + 12300
    const expectedNetBalance = (5000 + 3000 + 2000 + 1000) - (1000 + 500 + 700)
    const expectedRHS = expectedNetBalance + 10000

    expect(expectedLHS).toBe(expectedRHS) // proves the identity itself
    expect(expectedLHS).toBe(18800)

    const result = booksBalanceCheck(ledger)
    expect(result).toEqual({ balanced: true, discrepancyPaise: 0 })

    // Cross-check against the individually-tested functions too.
    expect(volunteerCashInHand('v1', ledger)).toBe(2000)
    expect(volunteerCashInHand('v2', ledger)).toBe(3000)
    expect(cashHeldByTreasurer(ledger)).toBe(1500)
    expect(bankBalance(ledger)).toBe(12300)
    expect(netBalance(ledger)).toBe(expectedNetBalance)
  })

  it('stays balanced when a cash donation is collected by an admin (the flagship-feature fix)', () => {
    // Same ledger as the identity-proof test, plus one extra cash donation
    // collected by the admin a1 (a natural action: the "Collect donation"
    // card is on the admin dashboard). This used to break the books; now the
    // admin's cash is held by the treasurer directly, so cashHeldByTreasurer
    // accounts for it and the identity still holds.
    const ledger: Ledger = {
      users: [
        { id: 'v1', role: 'volunteer' },
        { id: 'v2', role: 'volunteer' },
        { id: 'a1', role: 'admin' },
      ],
      donations: [
        { amountPaise: 5000, mode: 'cash', collectedBy: 'v1', voided: false },
        { amountPaise: 3000, mode: 'cash', collectedBy: 'v2', voided: false },
        { amountPaise: 2000, mode: 'upi', collectedBy: 'v1', voided: false },
        { amountPaise: 1000, mode: 'bank', collectedBy: 'v2', voided: false },
        { amountPaise: 4000, mode: 'cash', collectedBy: 'a1', voided: false },
      ],
      expenses: [
        { amountPaise: 1000, paidFrom: 'cash', paidBy: 'v1', voided: false },
        { amountPaise: 500, paidFrom: 'cash', paidBy: 'a1', voided: false },
        { amountPaise: 700, paidFrom: 'bank', paidBy: 'a1', voided: false },
      ],
      handovers: [
        { amountPaise: 2000, volunteerId: 'v1', receivedBy: 'a1', voided: false },
      ],
      bankOpeningPaise: 10000,
    }

    // LHS now includes the admin's 4000 cash inside cashHeldByTreasurer:
    //   Σ volunteers   = 2000 (v1) + 3000 (v2)                        = 5000
    //   cashHeldByTreasurer = 2000 (handover) + 4000 (admin cash) - 500 = 5500
    //   bankBalance    = 10000 + 2000 + 1000 - 700                     = 12300
    const expectedLHS = 5000 + 5500 + 12300
    const expectedNetBalance = (5000 + 3000 + 2000 + 1000 + 4000) - (1000 + 500 + 700)
    const expectedRHS = expectedNetBalance + 10000
    expect(expectedLHS).toBe(22800)
    expect(expectedRHS).toBe(22800)
    expect(expectedLHS).toBe(expectedRHS) // the identity holds with admin cash

    const result = booksBalanceCheck(ledger)
    expect(result).toEqual({ balanced: true, discrepancyPaise: 0 })
    expect(cashHeldByTreasurer(ledger)).toBe(5500)
  })
})
