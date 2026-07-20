import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'
import { AuthShell } from '../../components/AuthShell'
import { AuthMethods } from './AuthMethods'
import { isAdminRole } from '../../lib/roles'

const t = strings.auth

export function AdminLogin() {
  const { loading, session, appUser } = useAuth()

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-stone-50 font-body text-stone-400">{t.loading}</div>
  }

  // Already signed in? Don't show a login form. Route by role so a volunteer
  // who lands here isn't bounced to /admin (which would send them straight
  // back — a loop). A session with no `users` row is a fresh account that
  // still has to create/join a mandal, so send it to onboarding.
  if (session) {
    if (appUser) return <Navigate to={isAdminRole(appUser.role) ? '/admin' : '/collect'} replace />
    return <Navigate to="/signup" replace />
  }

  return (
    <AuthShell
      title={t.loginTitle}
      subtitle={t.loginSubtitle}
      footer={
        <div className="rounded-2xl border border-stone-200 bg-white/60 p-4 text-center">
          <p className="text-sm font-bold text-stone-800">{t.newHereTitle}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-stone-500">{t.newHere}</p>
          <p className="mt-3 border-t border-stone-200 pt-3 text-[13px] leading-relaxed text-stone-500">
            {t.volunteerHint}
          </p>
        </div>
      }
    >
      <AuthMethods redirectTo={`${window.location.origin}/admin`} />
    </AuthShell>
  )
}
