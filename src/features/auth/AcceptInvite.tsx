import { useEffect, useRef, useState } from 'react'
import { useAuth } from './useAuth'
import { acceptInvite, type InvitePreview } from '../../lib/db/members'
import { clearStashedInvite } from './inviteStash'
import { strings } from '../../lib/strings'
import { btnPrimary, btnGhost, errorText } from '../../components/ui'

const t = strings.resolver

// The one place a membership is created, whichever door the invite came
// through — /join/:token, a stashed token rescued after a lost redirect, or
// a code matched to the signed-in email. Both callers get identical
// confirmation behaviour because there is only one implementation of it.
//
// Two gates, in order, before accept_invite runs:
//
//   1. Already a member somewhere. Joining a second mandal ADDS a
//      membership and switches the session to it (app_mandal_id() resolves
//      to the newest-joined). Doing that silently would move someone's
//      whole console out from under them.
//   2. The invite names a different address than the one they signed in
//      with. Legal since v6 — possession is proof — but on a shared phone
//      it usually means the wrong Google account is selected, which is
//      worth one tap to catch.
//
// Neither gate applies to an email-matched invite (gate 2 is false by
// definition, and the resolver only reaches that path with no memberships),
// so that flow shows the plain interstitial and accepts straight through.
export function AcceptInvite({
  token,
  preview,
  onAccepted,
  onFailed,
  onCancel,
}: {
  token: string
  preview: InvitePreview
  onAccepted: (role: string) => void
  onFailed: (message: string) => void
  onCancel: () => void
}) {
  const { session, appUser, refreshAppUser } = useAuth()
  const signedInEmail = session?.user.email ?? ''

  const needsSecondMandal = appUser !== null
  // Truthiness, not `!== null`: an invite with no address to name can't
  // raise a meaningful "sent to someone else" confirm anyway.
  const needsMismatch = !preview.matchesCallerEmail && Boolean(preview.inviteeEmailMasked)

  const [gate, setGate] = useState<'second' | 'mismatch' | null>(
    needsSecondMandal ? 'second' : needsMismatch ? 'mismatch' : null,
  )
  const [error, setError] = useState<string | null>(null)
  const acceptingRef = useRef(false)

  useEffect(() => {
    if (gate !== null || acceptingRef.current) return
    acceptingRef.current = true
    acceptInvite(token)
      .then(async () => {
        clearStashedInvite()
        // The users row exists now, but this session's appUser was resolved
        // before it did and no auth event will fire to re-resolve it.
        await refreshAppUser()
        onAccepted(preview.role)
      })
      .catch((err: unknown) => {
        // The guard is deliberately NOT released. This screen offers no
        // retry, so one attempt is the whole contract — and both callers
        // pass inline callbacks, so every PARENT re-render hands this effect
        // fresh dependencies. AuthProvider rebuilds its context value on
        // each auth event (token refresh, tab focus), so releasing the guard
        // re-attempts the join on every one of them, indefinitely, for
        // anyone who leaves a failed invite page open. AcceptInvite's own
        // setState can't expose this — it keeps the props' identity — which
        // is why the regression test drives a parent re-render.
        const message = err instanceof Error ? err.message : String(err)
        // A failed accept must not leave the stash behind to retry itself
        // on every future visit.
        clearStashedInvite()
        setError(message)
        onFailed(message)
      })
  }, [gate, token, preview.role, refreshAppUser, onAccepted, onFailed])

  if (error) {
    return (
      <p role="alert" className={errorText}>
        {error}
      </p>
    )
  }

  if (gate === null) {
    return (
      <p className="text-center text-[15px] text-stone-500">
        {t.joiningPrefix} <span className="font-semibold text-stone-900">{preview.mandalName}</span>{' '}
        {t.joiningAs(preview.role === 'admin' ? t.roleAdmin : t.roleVolunteer)}…
      </p>
    )
  }

  const isSecond = gate === 'second'
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg font-bold text-stone-900">
          {isSecond ? t.secondMandalTitle : t.mismatchTitle}
        </h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-stone-600">
          {isSecond
            ? t.secondMandalBody(preview.mandalName)
            : t.mismatchBody(preview.inviteeEmailMasked ?? '', signedInEmail)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          // Clearing the first gate can reveal the second — an already-member
          // opening a link addressed to someone else hits both.
          setGate(isSecond && needsMismatch ? 'mismatch' : null)
        }}
        className={btnPrimary}
      >
        {isSecond ? t.secondMandalConfirm : t.mismatchConfirm}
      </button>
      <button type="button" onClick={onCancel} className={btnGhost}>
        {isSecond ? t.cancel : t.switchAccount}
      </button>
    </div>
  )
}
