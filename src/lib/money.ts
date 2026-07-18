// Money is always integer paise internally — never floats for arithmetic.
// toRupees/formatINR only convert for display; they must never feed back
// into a sum.

export const toPaise = (rupees: number): number => Math.round(rupees * 100)

// Always two fraction digits (money reads as ₹10.50, never ₹10.5) and an
// explicit leading sign so a negative reads as -₹40.00, not ₹-40.00 (audit
// 2026-07-18 #13). The sign is placed before the ₹, and the magnitude is
// formatted from its absolute value.
export const formatINR = (paise: number): string => {
  const sign = paise < 0 ? '-' : ''
  const rupees = Math.abs(paise) / 100
  return `${sign}₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export const toRupees = (paise: number): number => paise / 100
