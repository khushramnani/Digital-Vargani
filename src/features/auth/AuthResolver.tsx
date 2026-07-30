import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/db/client'
import { useAuth } from './useAuth'
import { AuthShell } from '../../components/AuthShell'
import { AcceptInvite } from './AcceptInvite'
import { readStashedInvite, clearStashedInvite } from './inviteStash'
import { previewInvite, myPendingInvites, type InvitePreview, type MyInvite } from '../../lib/db/members'
import { strings } from '../../lib/strings'
import { homePathFor } from '../../lib/roles'
import { btnPrimary, card, errorText } from '../../components/ui'

const t = strings.resolver

// /continue — the single answer to "you're signed in, now what?".
//
// Before this existed, four screens each guessed, and an invitee whose auth
// redirect came back to the wrong URL (the Supabase allowlist bug this whole
// change exists for) had no path forward at all: they held a valid session,
// no membership, and a token nobody was still holding. Now every one of
// those screens forwards here instead, and this is the only place that
// knows the order of the questions.
//
// The order is load-bearing, and every step has a failure path:
//
//   1. A stashed invite token — the OAuth rescue. If it no longer resolves,
//      clear it, say why, and FALL THROUGH. Never a dead end.
//   2. An existing membership — route by role. Same newest-joined membership
//      the server's app_mandal_id() resolves to, so the console they land in
//      is the tenant their queries will actually run against.
//   3. An invite addressed to their verified email — the magic-link rescue,
//      for the invitee who opened their link in Gmail and landed in a
//      different browser with an empty stash. Several matches means a
//      picker; never a silent "newest wins".
//   4. Nothing — /signup, carrying the address we failed to match so that
//      screen can say so instead of shrugging.
export function AuthResolver() {
  const { loading, session, appUser, refreshAppUser } = useAuth()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<'working' | 'accept' | 'pick'>('working')
  const [staleBanner, setStaleBanner] = useState(false)
  const [pending, setPending] = useState<{ token: string; preview: InvitePreview } | null>(null)
  const [choices, setChoices] = useState<MyInvite[]>([])
  const [error, setError] = useState<string | null>(null)
  const ranRef = useRef(false)

  // A MyInvite already carries everything a preview does, and it was matched
  // BY the caller's own verified email — so the mismatch gate is false by
  // construction and no second round trip is needed to learn that.
  const asPreview = useCallback(
    (invite: MyInvite): InvitePreview => ({
      mandalName: invite.mandalName,
      role: invite.role,
      invitee: invite.invitee,
      inviteeEmailMasked: null,
      matchesCallerEmail: true,
    }),
    [],
  )

  useEffect(() => {
    if (loading || !session || ranRef.current) return
    ranRef.current = true
    let active = true

    async function resolve() {
      // 1 — the stash.
      const stashed = readStashedInvite()
      if (stashed) {
        // A preview failure here is indistinguishable from an unresolvable
        // token, and both mean the same thing to the person waiting: this
        // link is no good, carry on without it.
        const preview = await previewInvite(stashed).catch(() => null)
        if (!active) return
        if (preview) {
          setPending({ token: stashed, preview })
          setPhase('accept')
          return
        }
        clearStashedInvite()
        setStaleBanner(true)
      }

      // 2 — an existing membership wins over hunting for new invites.
      if (appUser) {
        navigate(homePathFor(appUser.role), { replace: true })
        return
      }

      // 3 — the email rescue.
      const mine = await myPendingInvites().catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
        return null
      })
      if (!active || mine === null) return

      if (mine.length === 1) {
        setPending({ token: mine[0].code, preview: asPreview(mine[0]) })
        setPhase('accept')
        return
      }
      if (mine.length > 1) {
        setChoices(mine)
        setPhase('pick')
        return
      }

      // 4 — nothing to join. /signup names the address that found no invite,
      // which is the difference between a dead end and a fixable one.
      //
      // Router state, not a query param: a query param puts a real person's
      // email address into the URL bar, browser history, and every hosting
      // access log that records the path. Losing it on a refresh just falls
      // back to the plain card, which is the right trade for not writing PII
      // somewhere it is awkward to delete.
      navigate('/signup', { replace: true, state: { nomatch: session?.user.email ?? '' } })
    }

    resolve()
    return () => {
      active = false
    }
  }, [loading, session, appUser, navigate, asPreview])

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-stone-50 font-body text-stone-400">{strings.auth.loading}</div>
  }
  if (!session) return <Navigate to="/login" replace />

  const banner = staleBanner ? (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800">
      <p role="alert">{t.staleInvite}</p>
      <p className="mt-1 text-amber-700/80">{t.staleInviteHelp}</p>
    </div>
  ) : null

  if (phase === 'pick') {
    return (
      <AuthShell title={t.pickTitle} subtitle={t.pickBody}>
        {banner}
        <ul className="flex flex-col gap-2.5">
          {choices.map((invite) => (
            <li key={invite.code}>
              <button
                type="button"
                onClick={() => {
                  setPending({ token: invite.code, preview: asPreview(invite) })
                  setPhase('accept')
                }}
                className={`${card} flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:border-orange-300`}
              >
                <span>
                  <span className="block font-semibold text-stone-900">{invite.mandalName}</span>
                  <span className="block text-[13px] text-stone-500">
                    {invite.role === 'admin' ? t.roleAdmin : t.roleVolunteer}
                  </span>
                </span>
                <span className="text-sm font-semibold text-orange-600">{t.pickCta}</span>
              </button>
            </li>
          ))}
        </ul>
      </AuthShell>
    )
  }

  if (phase === 'accept' && pending) {
    return (
      <AuthShell title={pending.preview.mandalName}>
        {banner}
        <AcceptInvite
          token={pending.token}
          preview={pending.preview}
          onAccepted={(role) => navigate(homePathFor(role), { replace: true })}
          // Hoist the message and drop `pending`: leaving AcceptInvite
          // mounted would keep a join on screen that has already failed,
          // and unmounting it without taking the message first would throw
          // the only explanation away.
          onFailed={(message) => {
            setError(message)
            setPending(null)
          }}
          onCancel={async () => {
            clearStashedInvite()
            // "Not now" from an existing member means keep what they have;
            // "use a different account" means the session itself is wrong.
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

  // Whatever went wrong — a failed accept, or a failed invite lookup — the
  // person still needs a door out, so this always offers one rather than
  // leaving them staring at the message.
  if (error) {
    return (
      <AuthShell title={strings.auth.retryTitle}>
        <div className="flex flex-col gap-4">
          <p role="alert" className={errorText}>
            {error}
          </p>
          <button
            type="button"
            onClick={() =>
              appUser ? navigate(homePathFor(appUser.role), { replace: true }) : navigate('/signup', { replace: true })
            }
            className={`w-full ${btnPrimary}`}
          >
            {appUser ? strings.auth.goToMandal : t.cancel}
          </button>
        </div>
      </AuthShell>
    )
  }

  return <div className="flex min-h-screen items-center justify-center bg-stone-50 font-body text-stone-400">{t.working}</div>
}
