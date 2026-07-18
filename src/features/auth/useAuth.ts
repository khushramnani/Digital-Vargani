import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Tables } from '../../lib/db/database.types'

// The acting app user for the current session. Role-aware (not
// admin-hardcoded) — Task 5 (volunteer invite-link auth) extends the same
// session -> appUser resolution for volunteer sessions, no rework needed.
export type AppUser = Tables<'users'>

export type AuthContextValue = {
  session: Session | null
  appUser: AppUser | null
  // True when the `users` lookup for the current session FAILED (network/RLS),
  // as opposed to succeeding with no row. RequireRole shows a retry for this
  // rather than redirecting to create-a-mandal (audit 2026-07-18 #4).
  appUserError: boolean
  loading: boolean
  // Re-runs the `users` lookup for the current session on demand. Needed
  // after a redeem-style RPC (e.g. Task 5's redeem_invite) links a row that
  // didn't exist yet when the session listener last resolved appUser —
  // there's no auth-state-change event to react to for that, since the
  // session itself doesn't change, only the `users` row it points at.
  refreshAppUser: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
