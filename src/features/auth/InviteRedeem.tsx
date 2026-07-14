import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/db/client'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'

// Public route (/invite/:token), no RequireRole guard — that's the point:
// this is how a volunteer gets a session in the first place, per SPEC.md's
// "no passwords, no OTP" auth model. Flow: sign out any lingering session
// (don't bind someone else's session to this invite) -> signInAnonymously()
// for a fresh auth identity -> redeem_invite(token) links it to the invited
// `users` row -> refreshAppUser() so this session's appUser reflects the
// just-linked row (the auth-state-change listener already resolved appUser
// once, before redeem_invite ran, and won't fire again on its own) ->
// redirect to the volunteer home placeholder.
export function InviteRedeem() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { refreshAppUser } = useAuth()
  const [status, setStatus] = useState<'redeeming' | 'error'>('redeeming')

  // startedRef ensures the actual redeem network calls (getSession /
  // signInAnonymously / redeem_invite) fire only once per component
  // instance, even though StrictMode's dev-only double-invoke runs this
  // effect's body twice (mount -> cleanup -> mount again). Without it, both
  // invocations race to redeem the same one-time-use token.
  //
  // activeRef is a separate concern: whether it's still safe to apply the
  // result (setStatus/navigate) once redeem() resolves. It's set true at
  // the top of every effect invocation and false in its cleanup, so
  // StrictMode's synthetic cleanup-then-remount flips it back to true
  // before redeem() resolves (the component is genuinely still mounted),
  // while a real unmount — with no remount after — correctly leaves it
  // false so a late-resolving redeem() doesn't touch unmounted state.
  const startedRef = useRef(false)
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true

    async function redeem() {
      if (!token) {
        if (activeRef.current) setStatus('error')
        return
      }

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
      if (activeRef.current) navigate('/volunteer', { replace: true })
    }

    if (!startedRef.current) {
      startedRef.current = true
      redeem()
    }

    return () => {
      activeRef.current = false
    }
  }, [token, navigate, refreshAppUser])

  if (status === 'error') {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-2 px-4 text-center">
        <p role="alert" className="text-stone-900">
          {strings.auth.inviteInvalid}
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-stone-400">{strings.auth.loading}</p>
    </main>
  )
}
