// Pure, testable domain logic — no I/O, no Supabase types. Only
// non-voided rows count anywhere below.

type UserId = string

export interface LedgerUser {
  id: UserId
  role: 'admin' | 'volunteer'
}

export interface LedgerDonation {
  amountPaise: number
  mode: 'cash' | 'upi' | 'bank'
  collectedBy: UserId
  voided: boolean
}

export interface LedgerExpense {
  amountPaise: number
  paidFrom: 'cash' | 'bank'
  paidBy: UserId
  voided: boolean
}

export interface LedgerHandover {
  amountPaise: number
  volunteerId: UserId
  receivedBy: UserId
  voided: boolean
}

export interface Ledger {
  users: LedgerUser[]
  donations: LedgerDonation[]
  expenses: LedgerExpense[]
  handovers: LedgerHandover[]
  bankOpeningPaise: number
}

const sumWhere = <T extends { amountPaise: number }>(
  items: T[],
  predicate: (item: T) => boolean,
): number => items.filter(predicate).reduce((sum, item) => sum + item.amountPaise, 0)

export function volunteerCashInHand(volunteerId: UserId, ledger: Ledger): number {
  const cashIn = sumWhere(
    ledger.donations,
    (d) => d.mode === 'cash' && d.collectedBy === volunteerId && !d.voided,
  )
  const cashOut = sumWhere(
    ledger.expenses,
    (e) => e.paidFrom === 'cash' && e.paidBy === volunteerId && !e.voided,
  )
  const handed = sumWhere(
    ledger.handovers,
    (h) => h.volunteerId === volunteerId && !h.voided,
  )
  return cashIn - cashOut - handed
}

export function totalCollected(ledger: Ledger): number {
  return sumWhere(ledger.donations, (d) => !d.voided)
}

export function totalExpenses(ledger: Ledger): number {
  return sumWhere(ledger.expenses, (e) => !e.voided)
}

export function netBalance(ledger: Ledger): number {
  return totalCollected(ledger) - totalExpenses(ledger)
}

export function cashHeldByTreasurer(ledger: Ledger): number {
  const adminIds = new Set(
    ledger.users.filter((u) => u.role === 'admin').map((u) => u.id),
  )
  const handed = sumWhere(ledger.handovers, (h) => !h.voided)
  const adminCashExpenses = sumWhere(
    ledger.expenses,
    (e) => e.paidFrom === 'cash' && adminIds.has(e.paidBy) && !e.voided,
  )
  return handed - adminCashExpenses
}

export function bankBalance(ledger: Ledger): number {
  const online = sumWhere(
    ledger.donations,
    (d) => (d.mode === 'upi' || d.mode === 'bank') && !d.voided,
  )
  const bankExpenses = sumWhere(
    ledger.expenses,
    (e) => e.paidFrom === 'bank' && !e.voided,
  )
  return ledger.bankOpeningPaise + online - bankExpenses
}

export interface BooksBalanceResult {
  balanced: boolean
  discrepancyPaise: number // signed: (computed LHS) − (netBalance + bankOpeningPaise)
}

// Books-balance identity. Only holds if cash donations are always
// collected by a `role: 'volunteer'` user (never an admin), and
// cashHeldByTreasurer only nets out admin-attributed cash expenses.
//
// Proof: let C_v = cash donations per volunteer, E_v = cash expenses per
// volunteer, H_v = handovers per volunteer, E_admin = admin's cash
// expenses, D_online = all upi+bank donations, E_bank = all bank
// expenses, B0 = bankOpeningPaise.
//
//   Σ_v volunteerCashInHand(v) = Σ_v(C_v − E_v − H_v) = ΣC_v − ΣE_v − ΣH_v
//   cashHeldByTreasurer        = ΣH_v − E_admin
//   bankBalance                = B0 + D_online − E_bank
//
//   LHS = (ΣC_v − ΣE_v − ΣH_v) + (ΣH_v − E_admin) + (B0 + D_online − E_bank)
//       = ΣC_v + D_online − ΣE_v − E_admin − E_bank + B0
//       = totalCollected − totalExpenses + B0
//       = netBalance + B0
//       = RHS  ✓
export function booksBalanceCheck(ledger: Ledger): BooksBalanceResult {
  const volunteerTotal = ledger.users
    .filter((u) => u.role === 'volunteer')
    .reduce((sum, u) => sum + volunteerCashInHand(u.id, ledger), 0)

  const lhs = volunteerTotal + cashHeldByTreasurer(ledger) + bankBalance(ledger)
  const rhs = netBalance(ledger) + ledger.bankOpeningPaise
  const discrepancyPaise = lhs - rhs

  return { balanced: discrepancyPaise === 0, discrepancyPaise }
}
