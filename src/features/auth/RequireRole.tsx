import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'

// users.role is a plain `text` column with a CHECK constraint (not a
// Postgres enum — see database.types.ts), so this union is asserted here
// for call-site DX rather than derived from the generated Row type.
type Role = 'admin' | 'volunteer'

// Generalized from Task 4's ProtectedAdminRoute: any route can require any
// single role, or any one of several roles (e.g. a volunteer-flow route an
// admin should also be able to use), by passing either a single Role or a
// Role[].
export function RequireRole({ role, children }: { role: Role | Role[]; children: ReactNode }) {
  const { loading, session, appUser } = useAuth()
  const allowedRoles = Array.isArray(role) ? role : [role]

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-stone-400">{strings.auth.loading}</div>
    )
  }

  if (!session || !appUser || !allowedRoles.includes(appUser.role as Role)) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
