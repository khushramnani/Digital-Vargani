// Pure, testable domain logic — no I/O, no Supabase types. Only
// non-voided rows count anywhere below.
import { isAdminRole, type Role } from './roles'

type UserId = string

export interface LedgerUser {
  id: UserId
  role: Role
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
    ledger.users.filter((u) => isAdminRole(u.role)).map((u) => u.id),
  )
  const handed = sumWhere(ledger.handovers, (h) => !h.voided)
  // An admin who collects a cash donation directly is holding that cash
  // themselves — it never passes through a volunteer or a handover — so it
  // belongs in the treasurer's cash exactly like a handover does. Without
  // this term an admin-collected cash donation inflates totalCollected (the
  // RHS) with no matching LHS entry, and the books-balance indicator goes
  // permanently red on a natural admin action.
  const adminCashDonations = sumWhere(
    ledger.donations,
    (d) => d.mode === 'cash' && adminIds.has(d.collectedBy) && !d.voided,
  )
  const adminCashExpenses = sumWhere(
    ledger.expenses,
    (e) => e.paidFrom === 'cash' && adminIds.has(e.paidBy) && !e.voided,
  )
  return handed + adminCashDonations - adminCashExpenses
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

// Books-balance identity. Cash donations may be collected by either a
// volunteer or an admin: a volunteer's cash flows through volunteerCashInHand
// (and a later handover), an admin's cash is held by the treasurer directly,
// and cashHeldByTreasurer now accounts for both. The one remaining modelling
// assumption is that every handover is FROM a volunteer (volunteer → admin) —
// which the app enforces at the UI — since a handover is subtracted per
// volunteer but added in full to the treasurer's cash.
//
// Proof: let C_v = cash donations per volunteer, C_a = admin cash donations,
// E_v = cash expenses per volunteer, H_v = handovers per volunteer,
// E_admin = admin's cash expenses, D_online = all upi+bank donations,
// E_bank = all bank expenses, B0 = bankOpeningPaise.
//
//   Σ_v volunteerCashInHand(v) = Σ_v(C_v − E_v − H_v) = ΣC_v − ΣE_v − ΣH_v
//   cashHeldByTreasurer        = ΣH_v + C_a − E_admin
//   bankBalance                = B0 + D_online − E_bank
//
//   LHS = (ΣC_v − ΣE_v − ΣH_v) + (ΣH_v + C_a − E_admin) + (B0 + D_online − E_bank)
//       = (ΣC_v + C_a + D_online) − (ΣE_v + E_admin + E_bank) + B0
//       = totalCollected − totalExpenses + B0   (every donation and every
//         expense is attributed to exactly one of the buckets above)
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
