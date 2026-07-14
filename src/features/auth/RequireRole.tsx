import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'

// users.role is a plain `text` column with a CHECK constraint (not a
// Postgres enum — see database.types.ts), so this union is asserted here
// for call-site DX rather than derived from the generated Row type.
type Role = 'admin' | 'volunteer'

// Generalized from Task 4's ProtectedAdminRoute: any route can require any
// single role by passing it in, instead of each route reimplementing the
// same loading/redirect guard logic.
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { loading, session, appUser } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-stone-400">{strings.auth.loading}</div>
    )
  }

  if (!session || appUser?.role !== role) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
