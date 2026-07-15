// Pure client-side mirror of the DB CHECK constraint on `handovers`
// (amount_paise > 0) plus a data-quality check that received_by is one of
// the mandal's active admins (not itself DB-enforced beyond the FK, just
// required here) — for immediate form feedback only, same pattern as
// validation/expense.ts.
import { strings } from '../strings'

export type HandoverFormInput = {
  amountRupees: string
  receivedBy: string
  note: string
}

export type HandoverValidationErrors = Partial<Record<'amountRupees' | 'receivedBy', string>>

const t = strings.handovers.errors

// `adminIds` is the mandal's currently active admins (from getAdmins/
// list_admins()) — passed in rather than fetched here so this stays a pure
// function, same as expense validation takes categories as an argument.
export function validateHandoverInput(
  input: HandoverFormInput,
  adminIds: string[],
): { valid: boolean; errors: HandoverValidationErrors } {
  const errors: HandoverValidationErrors = {}

  const amount = Number(input.amountRupees)
  if (!input.amountRupees.trim() || !Number.isFinite(amount) || amount <= 0) {
    errors.amountRupees = t.amountRupees
  }

  if (!input.receivedBy || !adminIds.includes(input.receivedBy)) {
    errors.receivedBy = t.receivedBy
  }

  return { valid: Object.keys(errors).length === 0, errors }
}
