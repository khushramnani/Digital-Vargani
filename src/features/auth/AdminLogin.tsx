import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'
import { AuthShell } from '../../components/AuthShell'
import { AuthMethods, type Status } from './AuthMethods'

const t = strings.auth

export function AdminLogin() {
  const { loading, session } = useAuth()
  // Tracks AuthMethods' own status so the footer below can hide itself once
  // the form is replaced by "check your email" — the footer's "sign in
  // above" copy is stale/misleading once there's no form to sign in with
  // above it (a real regression the original two-AuthShell version avoided;
  // collapsing to one AuthShell needs this to preserve that behavior).
  const [authStatus, setAuthStatus] = useState<Status>('idle')

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-stone-50 font-body text-stone-400">{t.loading}</div>
  }

  // Already signed in? Don't show a login form — hand the whole "where does
  // this person belong" question to /continue, which is the only place that
  // also checks for a stashed invite token or one waiting on their email.
  // Deciding it here as well is how an invitee used to end up stranded on a
  // create-a-mandal screen with their invite sitting unclaimed.
  if (session) return <Navigate to="/continue" replace />

  return (
    <AuthShell
      title={t.loginTitle}
      subtitle={t.loginSubtitle}
      footer={
        authStatus === 'sent' ? undefined : (
          <div className="rounded-2xl border border-stone-200 bg-white/60 p-4 text-center">
            <p className="text-sm font-bold text-stone-800">{t.newHereTitle}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-stone-500">{t.newHere}</p>
            <p className="mt-3 border-t border-stone-200 pt-3 text-[13px] leading-relaxed text-stone-500">
              {t.volunteerHint}
            </p>
          </div>
        )
      }
    >
      {/* /continue, not /admin: a volunteer signing in here would bounce
          off RequireRole, and an invitee needs the resolver's rescue paths. */}
      <AuthMethods redirectTo={`${window.location.origin}/continue`} onStatusChange={setAuthStatus} />
    </AuthShell>
  )
}
