import { useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { createMandal } from '../../lib/db/mandals'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'
import { AuthShell } from '../../components/AuthShell'
import { CityTypeahead } from '../../components/CityTypeahead'

const t = strings.signup

const inputCls =
  'rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-[15px] text-stone-900 outline-none placeholder:text-stone-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20'

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

function Field({ label, optional, help, children }: { label: string; optional?: boolean; help?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline gap-2 text-sm font-semibold text-stone-700">
        {label}
        {optional && <span className="text-xs font-medium text-stone-400">{t.optional}</span>}
      </span>
      {children}
      {help && <span className="text-xs leading-relaxed text-stone-500">{help}</span>}
    </label>
  )
}

// Reached after a magic link / Google sign-in resolves for someone who has
// no `users` row yet — the one authenticated-but-not-a-member state in the
// app. Guarded on both sides: no session -> /login (get an identity first),
// already a member -> /admin (create_mandal would reject them anyway).
export function Signup() {
  const { session, appUser, loading, refreshAppUser } = useAuth()
  const navigate = useNavigate()
  // /signup is a fork, not a create-only form: a volunteer/admin who signed
  // in directly (Google/magic link) instead of tapping their invite link lands
  // here too, and must have a path that isn't "create a mandal" (audit #4).
  const [mode, setMode] = useState<'choose' | 'create' | 'invited'>('choose')
  const [mandalName, setMandalName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [cityVal, setCityVal] = useState('')
  const [stateVal, setStateVal] = useState('')
  const [address, setAddress] = useState('')
  const [slugHint, setSlugHint] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-stone-50 font-body text-stone-400">{strings.auth.loading}</div>
  }
  if (!session) return <Navigate to="/login" replace />
  if (appUser) return <Navigate to="/admin" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      // Blank optional fields go over the wire as undefined, not '': only
      // then does each RPC `default null` apply (server derives the slug,
      // and state/address land as NULL rather than empty strings).
      await createMandal(mandalName, adminName, {
        slugHint: slugHint.trim() || undefined,
        state: stateVal || undefined,
        address: address.trim() || undefined,
        city: cityVal.trim() || undefined,
      })
      // The users row exists now but this session's appUser is still null —
      // the auth state never changed, so no listener re-resolves it.
      // RequireRole on /admin reads appUser, so refresh before navigating.
      await refreshAppUser()
      navigate('/admin', { replace: true })
    } catch (err) {
      // The DB's messages are already user-facing and specific (already has
      // a mandal / was invited elsewhere / anonymous session).
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const c = strings.signupChoice

  if (mode === 'choose') {
    return (
      <AuthShell title={c.title}>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setMode('create')}
            className="flex flex-col gap-1 rounded-2xl border border-stone-200 bg-white p-5 text-left transition-colors hover:border-orange-300"
          >
            <span className="text-base font-bold text-stone-900">{c.createTitle}</span>
            <span className="text-[13px] leading-relaxed text-stone-500">{c.createBody}</span>
            <span className="mt-1 text-sm font-semibold text-orange-600">{c.createCta}</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('invited')}
            className="flex flex-col gap-1 rounded-2xl border border-stone-200 bg-white p-5 text-left transition-colors hover:border-orange-300"
          >
            <span className="text-base font-bold text-stone-900">{c.invitedTitle}</span>
            <span className="text-[13px] leading-relaxed text-stone-500">{c.invitedBody}</span>
          </button>
        </div>
      </AuthShell>
    )
  }

  if (mode === 'invited') {
    return (
      <AuthShell title={c.invitedTitle} subtitle={c.invitedBody}>
        <div className="flex flex-col gap-4">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800">
            {c.invitedHint}
          </p>
          <button
            type="button"
            onClick={() => setMode('choose')}
            className="text-center text-sm font-semibold text-stone-500 hover:text-stone-700"
          >
            {c.back}
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t.title} subtitle={t.intro}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t.mandalNameLabel}>
          <input
            required
            value={mandalName}
            onChange={(e) => setMandalName(e.target.value)}
            placeholder={t.mandalNamePlaceholder}
            className={inputCls}
          />
        </Field>

        <Field label={t.adminNameLabel}>
          <input
            required
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            placeholder={t.adminNamePlaceholder}
            className={inputCls}
          />
        </Field>

        <CityTypeahead
          city={cityVal}
          state={stateVal}
          onChange={({ city, state }) => {
            setCityVal(city)
            setStateVal(state)
          }}
          label={t.cityLabel}
          placeholder={t.cityPlaceholder}
          help={t.cityHelp}
          useAsTypedLabel={t.cityUseAsTyped}
          stateLabel={t.stateLabel}
          statePlaceholder={t.statePlaceholder}
        />

        <Field label={t.addressLabel} optional help={t.addressHelp}>
          <textarea
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t.addressPlaceholder}
            className={`${inputCls} resize-none`}
          />
        </Field>

        <Field
          label={t.slugLabel}
          optional
          // Contiguous text (not a nested <span>) so the founder sees the whole
          // link they're choosing as one string before committing to it.
          help={
            slugHint.trim() || mandalName.trim()
              ? `${t.slugPreviewPrefix}${previewSlug(slugHint, mandalName)}`
              : t.slugHelp
          }
        >
          <input value={slugHint} onChange={(e) => setSlugHint(e.target.value)} className={inputCls} />
        </Field>

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded-xl bg-orange-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-colors hover:bg-stone-900 disabled:opacity-50"
        >
          {submitting ? t.submitting : t.submit}
        </button>
        <p className="text-center text-xs text-stone-400">{t.stepHint}</p>
        <button
          type="button"
          onClick={() => setMode('choose')}
          className="text-center text-sm font-semibold text-stone-500 hover:text-stone-700"
        >
          {strings.signupChoice.back}
        </button>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </AuthShell>
  )
}
