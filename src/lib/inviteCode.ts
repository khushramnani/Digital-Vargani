// An invite travels as two interchangeable halves: a 64-char link token and
// a 10-char code. The code exists because the link doesn't survive being
// read aloud down a phone line or retyped off a WhatsApp screenshot.
//
// Whatever arrives in the "invite code" box — a code, a code with the
// display dash still in, a whole pasted /join/ URL — normalizes to something
// accept_invite can resolve. The server normalizes identically
// (normalize_invite_code in 20260729120000); this end is only so the UI can
// validate and display before a round trip.

// Mirrors the server alphabet: no I, L, O, 0 or 1, because those are what
// people get wrong when they hear or copy a code.
const CODE_ALPHABET = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/

export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

// K7M29XPQ4R -> K7M29-XPQ4R. Two groups of five is the longest run most
// people can hold in working memory while copying.
export function formatInviteCode(code: string): string {
  const n = normalizeInviteCode(code)
  return n.length === 10 ? `${n.slice(0, 5)}-${n.slice(5)}` : n
}

export function isInviteCode(raw: string): boolean {
  return CODE_ALPHABET.test(normalizeInviteCode(raw))
}

// The box is labelled "invite code", so of course people paste the link into
// it. Accepts a bare token, a bare code, or either wrapped in a /join/ (or
// pre-v5 /invite/) URL, and returns whatever accept_invite should be handed.
// Returns null only for genuinely empty input — an unrecognised string is
// still passed through, so the server gets to give the real error rather
// than this guessing.
export function extractInviteToken(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const fromUrl = trimmed.match(/\/(?:join|invite)\/([^/?#\s]+)/)
  const value = fromUrl ? fromUrl[1] : trimmed
  // A code may have been typed with spaces or the display dash; a 64-char
  // hex token must survive untouched, and normalizing it is a no-op anyway.
  return isInviteCode(value) ? normalizeInviteCode(value) : value
}
