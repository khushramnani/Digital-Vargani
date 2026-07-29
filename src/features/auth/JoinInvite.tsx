import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/db/client'
import { useAuth } from './useAuth'
import { previewInvite, type InvitePreview } from '../../lib/db/members'
import { strings } from '../../lib/strings'
import { AuthShell } from '../../components/AuthShell'
import { AuthMethods } from './AuthMethods'
import { AcceptInvite } from './AcceptInvite'
import { stashInvite, clearStashedInvite } from './inviteStash'
import { homePathFor } from '../../lib/roles'

const t = strings.auth

type Status = 'checking' | 'invalid' | 'ready'

// Public route — the fastest way in, when the link survives the trip.
//
// The :token param is now either half of an invite: a 64-char link token or
// a 10-char code, since /join/K7M29XPQ4R is a URL someone can actually read
// out. invite_preview and accept_invite both resolve either.
//
// The token is stashed BEFORE handing off to Google/email. If the project's
// Supabase redirect allowlist doesn't cover this URL, the round trip comes
// back to the landing page with the token gone — the stash is what lets
// AuthResolver still finish the join from wherever they land. Once a real
// session exists, AcceptInvite owns everything from here (both confirms and
// the accept itself), shared with the resolver so both doors behave alike.
export function JoinInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { loading, session, appUser, refreshAppUser } = useAuth()
  const [status, setStatus] = useState<Status>('checking')
  const [preview, setPreview] = useState<InvitePreview | null>(null)

  useEffect(() => {
    let active = true
    if (!token) {
      setStatus('invalid')
      return
    }
    previewInvite(token)
      .then((result) => {
        if (!active) return
        if (!result) {
          setStatus('invalid')
          return
        }
        setPreview(result)
        setStatus('ready')
      })
      // previewInvite throws on a genuine RPC failure (not just an
      // unresolved token) — this page has no retry affordance, so folding
      // it into the same invalid-link state is the honest simplest option;
      // the copy ("ask for a fresh link") is still directionally correct
      // even for a transient failure.
      .catch(() => {
        if (active) setStatus('invalid')
      })
    return () => {
      active = false
    }
  }, [token])

  if (loading || status === 'checking') {
    return <div className="flex min-h-screen items-center justify-center text-stone-400">{t.loading}</div>
  }

  if (status === 'invalid' || !token || !preview) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-2 px-4 text-center">
        <p role="alert" className="text-stone-900">
          {t.joinInvalid}
        </p>
        <p className="text-sm leading-relaxed text-stone-500">{t.joinInvalidHelp}</p>
      </main>
    )
  }

  const roleLabel = preview.role === 'admin' ? t.joinRoleAdmin : t.joinRoleVolunteer

  // A real (never anonymous) session is already here — either they just
  // came back from the auth round trip, or they were signed in all along.
  if (session && !session.user.is_anonymous) {
    return (
      <AuthShell title={preview.mandalName} subtitle={`${t.joinInvitedAsPrefix} ${roleLabel}, ${preview.invitee}`}>
        <AcceptInvite
          token={token}
          preview={preview}
          onAccepted={(role) => navigate(homePathFor(role), { replace: true })}
          onFailed={() => {}}
          onCancel={async () => {
            clearStashedInvite()
            if (appUser) {
              navigate(homePathFor(appUser.role), { replace: true })
            } else {
              await supabase.auth.signOut()
              await refreshAppUser()
              navigate('/login', { replace: true })
            }
          }}
        />
      </AuthShell>
    )
  }

  return (
    <AuthShell title={preview.mandalName} subtitle={`${t.joinInvitedAsPrefix} ${roleLabel}, ${preview.invitee}`}>
      <AuthMethods
        redirectTo={`${window.location.origin}/join/${token}`}
        // Belt and braces with redirectTo: that only works if this URL is in
        // the Supabase redirect allowlist, and this works even when it isn't.
        onBeforeRedirect={() => stashInvite(token)}
      />
    </AuthShell>
  )
}
