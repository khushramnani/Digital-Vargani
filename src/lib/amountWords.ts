// Amount in words for the donor receipt — the traditional tamper-evident line
// a paper bill-book always carried ("Rupees five hundred one only"). English,
// Indian numbering (lakh/crore); rendered in English on every receipt as the
// formal amount notation regardless of the receipt's display language.

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

// 0–99
function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10)
  const o = n % 10
  return o ? `${TENS[t]} ${ONES[o]}` : TENS[t]
}

// 0–999
function threeDigits(n: number): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  const parts: string[] = []
  if (h) parts.push(`${ONES[h]} hundred`)
  if (rest) parts.push(twoDigits(rest))
  return parts.join(' ')
}

// Whole rupees in Indian grouping. Recurses on the crore group so arbitrarily
// large amounts still read correctly (… crore … lakh … thousand … hundred).
function rupeesInWords(n: number): string {
  if (n === 0) return 'zero'
  const crore = Math.floor(n / 10_000_000)
  const lakh = Math.floor((n % 10_000_000) / 100_000)
  const thousand = Math.floor((n % 100_000) / 1_000)
  const hundred = n % 1_000
  const parts: string[] = []
  if (crore) parts.push(`${rupeesInWords(crore)} crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} thousand`)
  if (hundred) parts.push(threeDigits(hundred))
  return parts.join(' ')
}

// paise -> "five hundred one" (or "… and fifty paise" when there's a remainder).
export function amountInWords(paise: number): string {
  const abs = Math.abs(Math.trunc(paise))
  const rupees = Math.floor(abs / 100)
  const paiseRem = abs % 100
  let words = rupeesInWords(rupees)
  if (paiseRem > 0) words += ` and ${twoDigits(paiseRem)} paise`
  return words
}
