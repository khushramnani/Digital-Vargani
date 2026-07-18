import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/db/client'
import { clearOutbox } from '../../lib/queue/sync'
import { AuthContext, type AppUser } from './useAuth'

// Shared by the session-listener resolution below and refreshAppUser() —
// the "look up my users row" query has exactly one implementation.
async function fetchAppUser(authUserId: string): Promise<AppUser | null> {
  try {
    const { data } = await supabase.from('users').select('*').eq('auth_user_id', authUserId).maybeSingle()
    return data ?? null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshAppUser = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    const nextSession = data.session
    setSession(nextSession)
    setAppUser(nextSession ? await fetchAppUser(nextSession.user.id) : null)
  }, [])

  useEffect(() => {
    let active = true

    async function resolve(nextSession: Session | null) {
      if (!active) return
      setSession(nextSession)

      if (!nextSession) {
        setAppUser(null)
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

      const user = await fetchAppUser(nextSession.user.id)
      if (active) setAppUser(user)
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
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Wipe this device's offline queue when the session ends, so the next
      // person on a shared phone can't inherit the previous volunteer's
      // queued donor details (audit 2026-07-18 #3). Fire-and-forget like the
      // app's other IndexedDB calls.
      if (event === 'SIGNED_OUT') clearOutbox().catch(() => {})
      resolve(nextSession)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return (
    <AuthContext.Provider value={{ session, appUser, loading, refreshAppUser }}>{children}</AuthContext.Provider>
  )
}
