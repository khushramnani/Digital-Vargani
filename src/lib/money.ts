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

// The redesign (2026-08-18) renders every figure as two pieces — bold rupees
// and a dimmed paise tail (₹54,003 + .00) — so the eye lands on the rupees.
// Split here rather than in a component so it stays the same one arithmetic
// path as formatINR: `main + dec === formatINR(paise)` for every input, which
// the unit test asserts. Never feed either half back into a sum.
export const splitINR = (paise: number): { main: string; dec: string } => {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  return {
    main: `${sign}₹${Math.floor(abs / 100).toLocaleString('en-IN')}`,
    dec: `.${String(abs % 100).padStart(2, '0')}`,
  }
}

// "68%" — a share of a total, for the proportion bars and legends the redesign
// uses everywhere. Whole percent (the design prints no decimals), and "0%"
// rather than NaN when the total is zero, which is the state every screen is in
// before the first donation.
export const formatPct = (value: number, total: number): string =>
  total > 0 ? `${Math.round((value / total) * 100)}%` : '0%'
