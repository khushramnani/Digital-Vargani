import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../lib/db/client'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'
import { AuthShell } from '../../components/AuthShell'

const t = strings.auth

type Status = 'idle' | 'sending' | 'sent' | 'error'

const inputCls =
  'rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-[15px] text-stone-900 outline-none placeholder:text-stone-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20'

// The full-colour Google "G". Inline so the CSP-tight bundle carries no
// remote asset, and so it inherits nothing from the surrounding button.
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

export function AdminLogin() {
  const { loading, session, appUser } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [googleBusy, setGoogleBusy] = useState(false)

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-stone-50 font-body text-stone-400">{t.loading}</div>
  }

  // Already signed in? Don't show a login form. Route by role so a volunteer
  // who lands here isn't bounced to /admin (which would send them straight
  // back — a loop). A session with no `users` row is a fresh account that
  // still has to create its mandal, so send it to onboarding.
  if (session) {
    if (appUser) return <Navigate to={appUser.role === 'admin' ? '/admin' : '/collect'} replace />
    return <Navigate to="/signup" replace />
  }

  async function handleGoogle() {
    setGoogleBusy(true)
    setStatus('idle')
    setErrorMessage(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/admin` },
    })
    // On success the browser navigates away to Google; only an error path
    // returns control here.
    if (error) {
      setGoogleBusy(false)
      setStatus('error')
      setErrorMessage(t.googleError)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('sending')
    setErrorMessage(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/admin` },
    })
    if (error) {
      setStatus('error')
      setErrorMessage(error.message)
      return
    }
    setStatus('sent')
  }

  if (status === 'sent') {
    return (
      <AuthShell title={t.checkEmail}>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-2xl">✉️</div>
          <p className="text-[15px] leading-relaxed text-stone-600">
            {t.checkEmailSentTo} <span className="font-semibold text-stone-900">{email}</span>.
          </p>
          <p className="text-sm text-stone-500">{t.checkEmailHelp}</p>
          <button
            type="button"
            onClick={() => {
              setStatus('idle')
              setEmail('')
            }}
            className="mt-1 text-sm font-semibold text-orange-600 hover:text-orange-700"
          >
            {t.backToLogin}
          </button>
        </div>
      </AuthShell>
    )
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
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={handleGoogle}
          disabled={googleBusy}
          className="flex items-center justify-center gap-2.5 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-bold text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50"
        >
          <GoogleG />
          {googleBusy ? t.startingGoogle : t.continueWithGoogle}
        </button>

        <div className="flex items-center gap-3 text-xs font-semibold tracking-wide text-stone-400 uppercase">
          <span className="h-px flex-1 bg-stone-200" />
          {t.or}
          <span className="h-px flex-1 bg-stone-200" />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label htmlFor="admin-email" className="text-sm font-semibold text-stone-600">
            {t.emailLabel}
          </label>
          <input
            id="admin-email"
            type="email"
            required
            autoComplete="email"
            placeholder={t.emailPlaceholder}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputCls}
          />
          <button
            type="submit"
            disabled={status === 'sending'}
            className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-colors hover:bg-stone-900 disabled:opacity-50"
          >
            {status === 'sending' ? t.sending : t.sendLink}
          </button>
        </form>

        {status === 'error' && errorMessage && (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage}
          </p>
        )}
      </div>
    </AuthShell>
  )
}
