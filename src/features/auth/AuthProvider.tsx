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
// A person can now hold a membership in more than one mandal (v5) — .single()
// would throw the moment that's true for the signed-in identity. There's no
// mandal-switcher in this app yet, so the most-recently-joined ACTIVE
// membership is the session's active mandal — the same filter
// (`auth_user_id = auth.uid() and active`) and the same deterministic
// tie-break (created_at desc, id desc) that app_user_id()/app_user_role()/
// app_mandal_id() apply server-side (20260720130000), so client and server
// always agree on which mandal a session acts in.
async function fetchAppUser(authUserId: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('auth_user_id', authUserId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
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
