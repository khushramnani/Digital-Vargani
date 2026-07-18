import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/db/client'
import { AuthContext, type AppUser } from './useAuth'

// Shared by the session-listener resolution below and refreshAppUser() —
// the "look up my users row" query has exactly one implementation. Throws on
// a real fetch failure (network/RLS): callers must distinguish that from a
// genuine "no row" (data null, no error), because the two mean opposite
// things — a fetch failure must NOT be read as "not a member" and dump the
// user into create-a-mandal (audit 2026-07-18 #4).
async function fetchAppUser(authUserId: string): Promise<AppUser | null> {
  const { data, error } = await supabase.from('users').select('*').eq('auth_user_id', authUserId).maybeSingle()
  if (error) throw error
  return data ?? null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [appUserError, setAppUserError] = useState(false)
  const [loading, setLoading] = useState(true)

  const refreshAppUser = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    const nextSession = data.session
    setSession(nextSession)
    if (!nextSession) {
      setAppUser(null)
      setAppUserError(false)
      return
    }
    try {
      setAppUser(await fetchAppUser(nextSession.user.id))
      setAppUserError(false)
    } catch {
      setAppUser(null)
      setAppUserError(true)
    }
  }, [])

  useEffect(() => {
    let active = true

    async function resolve(nextSession: Session | null) {
      if (!active) return
      setSession(nextSession)

      if (!nextSession) {
        setAppUser(null)
        setAppUserError(false)
        setLoading(false)
        return
      }

      // One-time linking step for the chicken-and-egg problem: a
      // freshly-authenticated admin's `users` row has no `auth_user_id` yet.
      // The RPC is idempotent server-side (WHERE auth_user_id is null) and a
      // no-op for a non-admin email, so awaiting it here just avoids racing
      // the appUser query below on first login rather than being required.
      try {
        await supabase.rpc('link_admin_account')
      } catch {
        // Non-fatal: a failed/no-op link just means appUser resolves to
        // null below, which every route guard already treats as "no role".
      }

      try {
        const user = await fetchAppUser(nextSession.user.id)
        if (active) {
          setAppUser(user)
          setAppUserError(false)
        }
      } catch {
        // The lookup itself failed (network/RLS) — not the same as "no row".
        // Flag it so RequireRole shows a retry instead of a create-mandal
        // redirect.
        if (active) {
          setAppUser(null)
          setAppUserError(true)
        }
      }
      if (active) setLoading(false)
    }

    supabase.auth
      .getSession()
      .then(({ data }) => resolve(data.session))
      .catch(() => {
        if (active) setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      resolve(nextSession)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return (
    <AuthContext.Provider value={{ session, appUser, appUserError, loading, refreshAppUser }}>
      {children}
    </AuthContext.Provider>
  )
}
