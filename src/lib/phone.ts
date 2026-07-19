// E.164 phone helpers — pure, dependency-free, unit-testable. The single home
// for every "what country is this / how do I display it / what goes in a wa.me
// link" decision, so the old silent "any 10-digit number is +91" heuristic
// (send.ts) survives in exactly ONE place: normalizeToE164, for legacy rows.
import { COUNTRIES, type Country } from './countries'

const digitsOf = (s: string): string => (s ?? '').replace(/\D/g, '')

// Build an E.164 string from a picked country code + a typed national number.
// Empty national → '' (never a bare '+…' the callers would then treat as real).
export function toE164(dialCode: string, national: string): string {
  // Strip a national TRUNK prefix. UK, Italy, Russia — and plenty of Indians —
  // quote a mobile the way it's dialled domestically ("oh-seven-nine-one-one…"),
  // so a volunteer types 07911123456 under 🇬🇧 +44. Concatenating that verbatim
  // yields +4407911123456, which dials nowhere: the receipt silently goes to no
  // one while the donation is still marked sent. The trunk 0 is never part of
  // the international number.
  const nat = digitsOf(national).replace(/^0+/, '')
  if (!nat) return ''
  return `+${digitsOf(dialCode)}${nat}`
}

// The read-side normalizer that REPLACES send.ts's 10-digit heuristic. Only
// place the historical "10 digits ⇒ India" assumption survives, and only for
// LEGACY stored rows that predate the country picker.
export function normalizeToE164(raw: string): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('+')) {
    const d = digitsOf(trimmed)
    return d ? `+${d}` : ''
  }
  let digits = digitsOf(trimmed)
  if (!digits) return ''
  // '00' is the international ACCESS prefix (00 91 98765…) — what follows is
  // already an E.164 number. Treating it as part of the number manufactured a
  // dead '+00919876543210'.
  if (digits.startsWith('00')) digits = digits.slice(2)
  // A leading '0' is a national TRUNK prefix (09876543210 — how a large share
  // of Indians write their own mobile), never part of the international form.
  // Stripping it is what turns those legacy rows into a real +91 number instead
  // of the un-dialable '+09876543210' this used to produce — which then got
  // DISPLAYED as '+91 09876543210' next to a tel: link that went nowhere.
  digits = digits.replace(/^0+/, '')
  if (!digits) return ''
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
  // Many countries share a dial code (44 → GB/GG/IM/JE, 1 → 20+ NANP). Pick the
  // one a user actually means first — otherwise alphabetical order puts 🇦🇸
  // American Samoa's flag on every US number — then fall back to whichever
  // known nationalLength fits, then the first listed.
  const preferred = PRIMARY_ISO[dialCode]
  const rep =
    (preferred ? sharing.find((c) => c.iso === preferred) : undefined) ??
    sharing.find((c) => nationalLengthFits(c, national.length)) ??
    sharing[0]
  return { dialCode, national, iso: rep.iso }
}

// The country a shared dial code should resolve to in the UI.
const PRIMARY_ISO: Record<string, string> = { '1': 'US', '7': 'RU', '39': 'IT', '44': 'GB' }

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

  // Caller named the country → hold the number to exactly that one's length.
  if (iso) {
    const named = COUNTRIES.find((c) => c.iso === iso.toUpperCase())
    return named?.nationalLength == null || nationalLengthFits(named, national.length)
  }

  // Otherwise resolve the dial code the SAME way parseE164 does. Taking the
  // first-listed sharer instead silently disabled length checking for every
  // shared code: '44' resolved to Guernsey (no nationalLength) and shadowed
  // GB's 10, so an 11-digit UK number validated clean and its receipt went to
  // a number that doesn't exist. If ANY country on this dial code declares a
  // length, the national part must match one of them.
  const sharing = COUNTRIES.filter((c) => c.dialCode === dialCode)
  const known = sharing.filter((c) => c.nationalLength != null)
  if (known.length > 0 && !known.some((c) => nationalLengthFits(c, national.length))) return false
  return true
}
