// Pure client-side mirror of the DB CHECK constraints on `donations`
// (amount_paise > 0, mode in ('cash','upi','bank')) — for immediate form
// feedback only, the DB still enforces these regardless. Kept framework-free
// so it's trivially unit-testable without mounting CollectionForm.
import { strings } from '../strings'
import { isValidPhone } from '../phone'

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

  // Phone is optional (nullable in the schema): a donor may decline to share
  // one and must still be loggable (audit 2026-07-18 #8). The field is now an
  // E.164 string from PhoneInput; only validate when something was entered.
  const phone = input.donorPhone.trim()
  if (phone && !isValidPhone(phone)) {
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
