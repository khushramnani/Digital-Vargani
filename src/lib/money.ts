// Money is always integer paise internally — never floats for arithmetic.
// toRupees/formatINR only convert for display; they must never feed back
// into a sum.

export const toPaise = (rupees: number): number => Math.round(rupees * 100)

export const formatINR = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`

export const toRupees = (paise: number): number => paise / 100
