import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/db/client'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'
import { AuthShell } from '../../components/AuthShell'
import { btnPrimary, btnGhost } from '../../components/ui'

// Public route (/invite/:token), no RequireRole guard — that's the point:
// this is how a volunteer gets a session in the first place, per SPEC.md's
// "no passwords, no OTP" auth model. Flow: sign out any lingering session
// (don't bind someone else's session to this invite) -> signInAnonymously()
// for a fresh anon identity -> redeem_invite(token) links it to the invited
// `users` row -> refreshAppUser() so this session's appUser reflects the
// just-linked row -> redirect to the collection home.
//
// If a real (non-anonymous) session is already present, we DON'T silently
// sign it out: an admin tapping a volunteer's link to test it would be
// logged out AND burn the volunteer's one-time token (audit 2026-07-18 #4).
// We ask first.
export function InviteRedeem() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { refreshAppUser } = useAuth()
  // 'error' = the LINK is bad (unknown//already-redeemed token).
  // 'session-error' = the link is fine but we could not create the anonymous
  // session redeem_invite requires. Collapsing the two sent an admin hunting a
  // token bug when the real cause was the anonymous provider being disabled.
  const [status, setStatus] = useState<'checking' | 'confirm' | 'redeeming' | 'error' | 'session-error'>('checking')
  // Who invited them, resolved from the token BEFORE any session exists.
  const [invite, setInvite] = useState<{ mandalName: string; volunteerName: string } | null>(null)

  // startedRef ensures the one-time pre-check fires only once per component
  // instance, even under StrictMode's dev-only mount -> cleanup -> mount
  // double-invoke. activeRef tracks whether it's still safe to apply results
  // (setStatus/navigate) once an async step resolves — flipped false on a
  // real unmount, back to true on StrictMode's synthetic remount.
  const startedRef = useRef(false)
  const activeRef = useRef(true)

  const redeem = useCallback(async () => {
    if (!token) {
      if (activeRef.current) setStatus('error')
      return
    }
    if (activeRef.current) setStatus('redeeming')

    const { data: existing } = await supabase.auth.getSession()
    if (existing.session) {
      await supabase.auth.signOut()
    }

    const { error: signInError } = await supabase.auth.signInAnonymously()
    if (signInError) {
      // NOT a bad link: the volunteer flow needs an anonymous session and the
      // project's anonymous provider is off (or auth is unreachable). Reporting
      // this as "invalid invite" is what made it look like a token problem.
      if (activeRef.current) setStatus('session-error')
      return
    }

    const { error: redeemError } = await supabase.rpc('redeem_invite', { token })
    if (redeemError) {
      if (activeRef.current) setStatus('error')
      return
    }

    await refreshAppUser()
    if (activeRef.current) navigate('/collect', { replace: true })
  }, [token, navigate, refreshAppUser])

  useEffect(() => {
    activeRef.current = true

    async function start() {
      if (!token) {
        if (activeRef.current) setStatus('error')
        return
      }

      // Resolve the invite from the token FIRST — it needs no session (public
      // definer RPC), so it both names the mandal for the welcome copy and
      // tells a genuinely dead token apart from a later session failure.
      const { data: preview } = await supabase.rpc('invite_preview', { token })
      const row = preview?.[0]
      if (!row) {
        if (activeRef.current) setStatus('error') // unknown or already-redeemed
        return
      }
      if (activeRef.current) setInvite({ mandalName: row.mandal_name, volunteerName: row.volunteer_name })

      const { data: existing } = await supabase.auth.getSession()
      // A non-anonymous session is a logged-in admin/user — confirm before
      // signing them out. Anonymous (a volunteer re-opening their link) or no
      // session: proceed straight through, the common path.
      if (existing.session && !existing.session.user.is_anonymous) {
        if (activeRef.current) setStatus('confirm')
        return
      }
      await redeem()
    }

    if (!startedRef.current) {
      startedRef.current = true
      start()
    }

    return () => {
      activeRef.current = false
    }
  }, [token, redeem])

  if (status === 'error') {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-2 px-4 text-center">
        <p role="alert" className="text-stone-900">
          {strings.auth.inviteInvalid}
        </p>
        <p className="text-sm leading-relaxed text-stone-500">{strings.auth.inviteInvalidHelp}</p>
      </main>
    )
  }

  // The link is valid — the problem is on the mandal's side. Say so, so nobody
  // goes looking for a broken token.
  if (status === 'session-error') {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-2 px-4 text-center">
        <p role="alert" className="font-semibold text-stone-900">
          {strings.auth.inviteSessionFailed}
        </p>
        <p className="text-sm leading-relaxed text-stone-500">{strings.auth.inviteSessionFailedHelp}</p>
      </main>
    )
  }

  if (status === 'confirm') {
    return (
      <AuthShell title={strings.auth.inviteSwitchTitle} subtitle={strings.auth.inviteSwitchBody}>
        {invite && <InviteWelcome mandalName={invite.mandalName} volunteerName={invite.volunteerName} />}
        <div className="flex flex-col gap-3">
          <button type="button" onClick={() => redeem()} className={btnPrimary}>
            {strings.auth.inviteSwitchContinue}
          </button>
          <button type="button" onClick={() => navigate('/', { replace: true })} className={btnGhost}>
            {strings.auth.inviteSwitchCancel}
          </button>
        </div>
      </AuthShell>
    )
  }

  // Once the token is confirmed live, name the mandal while the session is
  // being set up — the volunteer sees who invited them instead of a bare
  // "Loading…" on a link that arrived out of context on WhatsApp.
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-2 px-4 text-center">
      {invite ? (
        <>
          <InviteWelcome mandalName={invite.mandalName} volunteerName={invite.volunteerName} />
          <p className="text-sm text-stone-400">{strings.auth.inviteSettingUp}</p>
        </>
      ) : (
        <p className="text-stone-400">{strings.auth.loading}</p>
      )}
    </main>
  )
}

function InviteWelcome({ mandalName, volunteerName }: { mandalName: string; volunteerName: string }) {
  return (
    <div className="mb-4 flex flex-col items-center gap-1 text-center">
      {volunteerName.trim() && (
        <p className="text-[15px] text-stone-500">
          {strings.collection.greetingPrefix}
          {volunteerName}
        </p>
      )}
      <p className="text-sm text-stone-500">{strings.auth.inviteInvitedAs}</p>
      <p className="font-display text-xl font-extrabold tracking-tight text-stone-900">{mandalName}</p>
    </div>
  )
}
