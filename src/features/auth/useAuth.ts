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
  loading: boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
