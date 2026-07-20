import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'
import type { Role } from '../../lib/roles'

// Generalized from Task 4's ProtectedAdminRoute: any route can require any
// single role, or any one of several roles (e.g. a volunteer-flow route an
// admin should also be able to use), by passing either a single Role or a
// Role[].
export function RequireRole({ role, children }: { role: Role | Role[]; children: ReactNode }) {
  const { loading, session, appUser, appUserError, refreshAppUser } = useAuth()
  const allowedRoles = Array.isArray(role) ? role : [role]

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-stone-400">{strings.auth.loading}</div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  // The `users` lookup failed (network/RLS) — we don't actually know whether
  // they're a member. Offer a retry rather than treating it as "no membership"
  // and bouncing a real admin/volunteer into create-a-mandal (audit #4).
  if (appUserError) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-lg font-bold text-stone-900">{strings.auth.retryTitle}</p>
        <p className="text-sm leading-relaxed text-stone-500">{strings.auth.retryBody}</p>
        <button
          type="button"
          onClick={() => refreshAppUser()}
          className="mt-1 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-colors hover:bg-stone-900"
        >
          {strings.auth.retryButton}
        </button>
      </div>
    )
  }

  // Authenticated, but not a member of any mandal yet — they came in via a
  // magic link and never created one. /login would just re-send a link and
  // loop them back here; /signup is the only exit.
  if (!appUser) {
    return <Navigate to="/signup" replace />
  }

  if (!allowedRoles.includes(appUser.role as Role)) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
