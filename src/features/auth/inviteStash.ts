// Survives the auth round trip when Supabase's redirect allowlist doesn't.
//
// /join/:token sends the invitee off to Google or their email client with
// redirectTo=/join/<token>. If that URL isn't in the project's Auth →
// Redirect URLs list, Supabase silently falls back to Site URL and they land
// on the landing page holding a valid session and no token — the whole
// reason this file exists. Stashing the token first means AuthResolver can
// finish the join from wherever they land.
//
// This is NOT a substitute for my_pending_invites(). The stash survives
// OAuth (same browser, one round trip) but NOT a magic link opened in Gmail
// on a phone, which lands in a different browser with empty localStorage.
// Both rescue paths are load-bearing.

const KEY = 'vm.pendingInvite'
// Matches the invite's own 7-day expiry: past that the token cannot work, so
// replaying it would only produce a confusing error on an unrelated visit.
const MAX_AGE_MS = 7 * 86_400_000

export function stashInvite(token: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, writtenAt: Date.now() }))
  } catch {
    // Safari private mode / storage disabled. The email path still rescues
    // them, so this is a degraded flow, not a broken one.
  }
}

export function clearStashedInvite(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore — see above
  }
}

// Returns null (and self-clears) for anything stale, malformed, or absent,
// so callers only ever see a token worth trying.
export function readStashedInvite(): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    const { token, writtenAt } = (parsed ?? {}) as { token?: unknown; writtenAt?: unknown }
    if (typeof token !== 'string' || !token || typeof writtenAt !== 'number' || Date.now() - writtenAt > MAX_AGE_MS) {
      clearStashedInvite()
      return null
    }
    return token
  } catch {
    clearStashedInvite()
    return null
  }
}
