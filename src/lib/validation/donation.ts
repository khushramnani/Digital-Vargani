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
  // Plan 2026-08-18 §2: the donor didn't share a number and the volunteer said
  // so out loud. Optional so existing callers/tests keep compiling; absent
  // behaves as `false`.
  skipPhone?: boolean
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

  // A donor may decline to share a number and must still be loggable (audit
  // 2026-07-18 #8) — but plan 2026-08-18 §2 makes that a deliberate choice
  // instead of an empty field. The design's rule: `skip || valid phone`.
  //
  // Blank-and-not-skipped is now an error, and that is the point: a mistyped or
  // half-entered number used to save silently as "no phone", so the donor never
  // got their receipt and nothing on screen said why.
  const phone = input.donorPhone.trim()
  if (!input.skipPhone) {
    if (!phone) errors.donorPhone = t.donorPhoneRequired
    else if (!isValidPhone(phone)) errors.donorPhone = t.donorPhone
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
