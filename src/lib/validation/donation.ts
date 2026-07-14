// Pure client-side mirror of the DB CHECK constraints on `donations`
// (amount_paise > 0, mode in ('cash','upi','bank')) — for immediate form
// feedback only, the DB still enforces these regardless. Kept framework-free
// so it's trivially unit-testable without mounting CollectionForm.
import { strings } from '../strings'

export type DonationMode = 'cash' | 'upi' | 'bank'

const MODES: DonationMode[] = ['cash', 'upi', 'bank']

export type DonationFormInput = {
  donorName: string
  donorPhone: string
  amountRupees: string
  mode: DonationMode | ''
}

export type DonationValidationErrors = Partial<
  Record<'donorName' | 'donorPhone' | 'amountRupees' | 'mode', string>
>

const t = strings.collection.errors

export function validateDonationInput(
  input: DonationFormInput,
): { valid: boolean; errors: DonationValidationErrors } {
  const errors: DonationValidationErrors = {}

  if (!input.donorName.trim()) {
    errors.donorName = t.donorName
  }

  // Light format check, not full E.164 validation: strip non-digits and
  // require a plausible phone-number length.
  const phoneDigits = input.donorPhone.replace(/\D/g, '')
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    errors.donorPhone = t.donorPhone
  }

  const amount = Number(input.amountRupees)
  if (!input.amountRupees.trim() || !Number.isFinite(amount) || amount <= 0) {
    errors.amountRupees = t.amountRupees
  }

  if (!MODES.includes(input.mode as DonationMode)) {
    errors.mode = t.mode
  }

  return { valid: Object.keys(errors).length === 0, errors }
}
