import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from './useAuth'
import { previewInvite, acceptInvite, type InvitePreview } from '../../lib/db/members'
import { strings } from '../../lib/strings'
import { AuthShell } from '../../components/AuthShell'
import { AuthMethods } from './AuthMethods'
import { isAdminRole } from '../../lib/roles'

const t = strings.auth

type Status = 'checking' | 'invalid' | 'ready' | 'accepting' | 'accept-error'

// Public route (/join/:token) — the one way anyone, admin or volunteer,
// gets a membership under v5. No signInAnonymously anywhere: the invitee
// signs in with a real Google/email identity (AuthMethods), then
// accept_invite() links that identity to the invited row.
//
// A real (non-anonymous) session already present — whether they just
// finished the Google/email round trip back to this same URL, or they were
// already signed in from browsing the app earlier — skips straight to
// accepting, no extra confirm tap. accept_invite is mandal-scoped and
// idempotent, so there's nothing unsafe about that shortcut. ponytail: no
// "continue as X?" confirmation screen for the already-signed-in case;
// add one only if that shortcut ever proves surprising in practice.
export function JoinInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { loading, session, refreshAppUser } = useAuth()
  const [status, setStatus] = useState<Status>('checking')
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const acceptingRef = useRef(false)

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

  useEffect(() => {
    if (loading || status !== 'ready' || !session || session.user.is_anonymous || !token) return
    if (acceptingRef.current) return
    acceptingRef.current = true
    setStatus('accepting')
    acceptInvite(token)
      .then(async () => {
        await refreshAppUser()
        navigate(preview && isAdminRole(preview.role) ? '/admin' : '/collect', { replace: true })
      })
      .catch((err: unknown) => {
        acceptingRef.current = false
        setError(err instanceof Error ? err.message : String(err))
        setStatus('accept-error')
      })
  }, [loading, session, status, token, preview, refreshAppUser, navigate])

  if (status === 'checking') {
    return <div className="flex min-h-screen items-center justify-center text-stone-400">{t.loading}</div>
  }

  if (status === 'invalid') {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-2 px-4 text-center">
        <p role="alert" className="text-stone-900">
          {t.joinInvalid}
        </p>
        <p className="text-sm leading-relaxed text-stone-500">{t.joinInvalidHelp}</p>
      </main>
    )
  }

  if (status === 'accepting') {
    return <div className="flex min-h-screen items-center justify-center text-stone-400">{t.inviteSettingUp}</div>
  }

  // 'ready' or 'accept-error' — preview is always set by this point.
  const p = preview!
  const roleLabel = p.role === 'admin' ? t.joinRoleAdmin : t.joinRoleVolunteer

  return (
    <AuthShell title={p.mandalName} subtitle={`${t.joinInvitedAsPrefix} ${roleLabel}, ${p.invitee}`}>
      <AuthMethods redirectTo={`${window.location.origin}/join/${token}`} />
      {status === 'accept-error' && error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </AuthShell>
  )
}
