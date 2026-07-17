import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { createMandal } from '../../lib/db/mandals'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'

const t = strings.signup

// Mirrors the SQL slugify() + create_mandal()'s coalesce chain, for the
// inline preview only — the server slugifies again and is the authority. It
// may still append -2/-3 on a collision, which no client-side check can
// predict, so this shows the shape of the link rather than promising it.
function previewSlug(hint: string, mandalName: string): string {
  const slugify = (txt: string) =>
    txt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  return slugify(hint) || slugify(mandalName) || 'mandal'
}

// Reached after a magic link resolves for someone who has no `users` row
// yet — the one authenticated-but-not-a-member state in the app. Guarded on
// both sides: no session -> /login (get an identity first), already a member
// -> /admin (create_mandal would reject them anyway; don't show a form whose
// only outcome is an error).
export function Signup() {
  const { session, appUser, loading, refreshAppUser } = useAuth()
  const navigate = useNavigate()
  const [mandalName, setMandalName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [slugHint, setSlugHint] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-stone-400">{strings.auth.loading}</main>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (appUser) return <Navigate to="/admin" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      // A blank field must go over the wire as undefined, not '': only then
      // does the RPC's `default null` apply and the server derive the slug
      // from the mandal name.
      await createMandal(mandalName, adminName, slugHint.trim() || undefined)
      // The users row exists now but this session's appUser is still null —
      // the auth state never changed, so no listener will re-resolve it.
      // RequireRole on /admin reads appUser, so refresh before navigating.
      await refreshAppUser()
      navigate('/admin', { replace: true })
    } catch (err) {
      // The DB's messages are already user-facing and specific (already has
      // a mandal / was invited elsewhere / anonymous session) — surfacing
      // them verbatim beats a generic "something went wrong".
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold text-stone-900">{t.title}</h1>
      <p className="text-center text-sm text-stone-600">{t.intro}</p>
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
        <label htmlFor="mandal-name" className="text-sm text-stone-600">
          {t.mandalNameLabel}
        </label>
        <input
          id="mandal-name"
          type="text"
          required
          value={mandalName}
          onChange={(event) => setMandalName(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        <label htmlFor="admin-name" className="text-sm text-stone-600">
          {t.adminNameLabel}
        </label>
        <input
          id="admin-name"
          type="text"
          required
          value={adminName}
          onChange={(event) => setAdminName(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        <label htmlFor="slug-hint" className="text-sm text-stone-600">
          {t.slugLabel}
        </label>
        <input
          id="slug-hint"
          type="text"
          value={slugHint}
          onChange={(event) => setSlugHint(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        {/* The founder pastes this link into a WhatsApp group, so show what
            they are actually choosing before they commit to it. */}
        {(slugHint.trim() || mandalName.trim()) && (
          <p className="text-xs text-stone-500">
            {t.slugPreviewPrefix}
            {previewSlug(slugHint, mandalName)}
          </p>
        )}
        <p className="text-xs text-stone-500">{t.slugHelp}</p>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-orange-700 px-3 py-2 text-white disabled:opacity-50"
        >
          {submitting ? t.submitting : t.submit}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </form>
    </main>
  )
}
