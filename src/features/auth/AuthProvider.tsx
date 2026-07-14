import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/db/client'
import { AuthContext, type AppUser } from './useAuth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

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

      try {
        const { data } = await supabase
          .from('users')
          .select('*')
          .eq('auth_user_id', nextSession.user.id)
          .maybeSingle()
        if (active) setAppUser(data ?? null)
      } catch {
        if (active) setAppUser(null)
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

  return <AuthContext.Provider value={{ session, appUser, loading }}>{children}</AuthContext.Provider>
}
