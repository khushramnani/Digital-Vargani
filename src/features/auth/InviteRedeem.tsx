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
  const [status, setStatus] = useState<'checking' | 'confirm' | 'redeeming' | 'error'>('checking')

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
      if (activeRef.current) setStatus('error')
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

  if (status === 'confirm') {
    return (
      <AuthShell title={strings.auth.inviteSwitchTitle} subtitle={strings.auth.inviteSwitchBody}>
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

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-stone-400">{strings.auth.loading}</p>
    </main>
  )
}
