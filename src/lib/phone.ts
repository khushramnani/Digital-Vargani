// E.164 phone helpers — pure, dependency-free, unit-testable. The single home
// for every "what country is this / how do I display it / what goes in a wa.me
// link" decision, so the old silent "any 10-digit number is +91" heuristic
// (send.ts) survives in exactly ONE place: normalizeToE164, for legacy rows.
import { COUNTRIES, type Country } from './countries'

const digitsOf = (s: string): string => (s ?? '').replace(/\D/g, '')

// Build an E.164 string from a picked country code + a typed national number.
// Empty national → '' (never a bare '+…' the callers would then treat as real).
export function toE164(dialCode: string, national: string): string {
  const nat = digitsOf(national)
  if (!nat) return ''
  return `+${digitsOf(dialCode)}${nat}`
}

// The read-side normalizer that REPLACES send.ts's 10-digit heuristic. Only
// place the historical "10 digits ⇒ India" assumption survives, and only for
// LEGACY stored rows that predate the country picker.
export function normalizeToE164(raw: string): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''
  const digits = digitsOf(trimmed)
  if (!digits) return ''
  if (trimmed.startsWith('+')) return `+${digits}`
  // ponytail: the ONE surviving legacy assumption — a bare 10-digit number is
  // an Indian mobile missing its +91. New input arrives as E.164 from
  // PhoneInput, so this only ever fires on old stored rows.
  if (digits.length === 10) return `+91${digits}`
  return `+${digits}` // best effort: already has a country code, just missing +
}

// Split a stored E.164 value back into { dialCode, national, iso } to seed the
// PhoneInput country selector. Matches the LONGEST dial code that prefixes the
// number (so '1' vs '1876' etc. resolve to the most specific), then picks a
// representative country for that shared code.
export function parseE164(e164: string): { dialCode: string; national: string; iso: string } {
  const digits = digitsOf(e164)
  if (!digits) return { dialCode: '91', national: '', iso: 'IN' }

  let dialCode = ''
  for (const c of COUNTRIES) {
    if (digits.startsWith(c.dialCode) && c.dialCode.length > dialCode.length) dialCode = c.dialCode
  }
  if (!dialCode) return { dialCode: '91', national: digits, iso: 'IN' }

  const national = digits.slice(dialCode.length)
  const sharing = COUNTRIES.filter((c) => c.dialCode === dialCode)
  // Many countries share a dial code (44 → GB/GG/IM/JE, 1 → 20+ NANP). Prefer
  // the one whose known nationalLength fits the parsed number (disambiguates
  // +44 → GB over alphabetically-first Guernsey); else the first listed.
  const rep = sharing.find((c) => nationalLengthFits(c, national.length)) ?? sharing[0]
  return { dialCode, national, iso: rep.iso }
}

function nationalLengthFits(c: Country, len: number): boolean {
  if (c.nationalLength == null) return false
  return Array.isArray(c.nationalLength) ? c.nationalLength.includes(len) : c.nationalLength === len
}

// Pretty display: '+91 98765 43210' for India (5+5 of a 10-digit national),
// a light '+<cc> <national>' everywhere else. Blank → ''.
export function formatForDisplay(e164: string): string {
  if (!(e164 ?? '').trim()) return ''
  const { dialCode, national } = parseE164(e164)
  if (!national) return `+${dialCode}`
  if (dialCode === '91' && national.length === 10) {
    return `+91 ${national.slice(0, 5)} ${national.slice(5)}`
  }
  return `+${dialCode} ${national}`
}

// Digits only, no '+', for https://wa.me/<digits> links.
export function waDigits(e164: string): string {
  return digitsOf(e164)
}

// Lenient validity for a NON-blank phone: overall length inside E.164 bounds
// (6–15 digits), and — when the country's national length is known — the
// national part must match it. Callers keep optional/blank handling.
export function isValidPhone(e164: string, iso?: string): boolean {
  const digits = digitsOf(e164)
  if (digits.length < 6 || digits.length > 15) return false
  const { dialCode, national } = parseE164(e164)
  const country = iso
    ? COUNTRIES.find((c) => c.iso === iso.toUpperCase())
    : COUNTRIES.find((c) => c.dialCode === dialCode)
  if (country?.nationalLength != null && !nationalLengthFits(country, national.length)) return false
  return true
}
