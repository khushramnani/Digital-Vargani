import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'

export function ProtectedAdminRoute({ children }: { children: ReactNode }) {
  const { loading, session, appUser } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-stone-400">{strings.auth.loading}</div>
    )
  }

  if (!session || appUser?.role !== 'admin') {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
