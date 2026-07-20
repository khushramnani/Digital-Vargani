import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/db/client'
import { useAuth } from '../features/auth/useAuth'
import { strings } from '../lib/strings'
import { errorText } from './ui'

const t = strings.auth

// Transition aid for volunteers who joined before v5 (an anonymous Supabase
// session bound by the old invite_token flow — see the v5 plan's Decision
// 1). Upgrading in place (linkIdentity/updateUser) keeps the SAME
// auth_user_id, so the existing `users` row and every donation it collected
// stay attached: nothing to migrate, nothing server-side to call.
// ponytail: no "don't show again" persistence — a returning volunteer sees
// this again next visit until they actually upgrade, which is the point.
export function AnonUpgradeBanner() {
  const { session } = useAuth()
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!session?.user.is_anonymous || dismissed) return null

  async function upgradeWithGoogle() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: window.location.href } })
    setBusy(false)
    if (error) setError(error.message)
  }

  async function upgradeWithEmail(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ email })
    setBusy(false)
    if (!error) setSent(true)
  }

  return (
    <div className="mx-4 mt-3 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-amber-900">{t.upgradeTitle}</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t.upgradeDismiss}
          className="text-amber-600 hover:text-amber-800"
        >
          ✕
        </button>
      </div>
      {sent ? (
        <p className="text-amber-800">{t.upgradeEmailSent}</p>
      ) : (
        <>
          <p className="text-amber-800">{t.upgradeBody}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={upgradeWithGoogle}
              disabled={busy}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              {t.upgradeWithGoogle}
            </button>
            <form onSubmit={upgradeWithEmail} className="flex items-center gap-1.5">
              <input
                type="email"
                required
                placeholder={t.emailPlaceholder}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-40 rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-xs text-stone-900 outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {t.upgradeWithEmail}
              </button>
            </form>
          </div>
          {error && (
            <p role="alert" className={errorText}>
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}
