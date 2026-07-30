import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { createMandal } from '../../lib/db/mandals'
import { myPendingInvites, type MyInvite } from '../../lib/db/members'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'
import { AuthShell } from '../../components/AuthShell'
import { AuthMethods } from './AuthMethods'
import { CityTypeahead } from '../../components/CityTypeahead'
import { extractInviteToken } from '../../lib/inviteCode'
import { stashInvite } from './inviteStash'

const t = strings.signup
const c = strings.signupChoice

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

function ChoiceCard({ title, body, cta, onClick }: { title: string; body: string; cta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1 rounded-2xl border border-stone-200 bg-white p-5 text-left transition-colors hover:border-orange-300"
    >
      <span className="text-base font-bold text-stone-900">{title}</span>
      <span className="text-[13px] leading-relaxed text-stone-500">{body}</span>
      <span className="mt-1 text-sm font-semibold text-orange-600">{cta}</span>
    </button>
  )
}

// PUBLIC as of v6 — no session required. This is what "Sign up" on the
// landing page points at, and the fork happens before sign-in rather than
// after it, so someone who was invited never has to sit through a
// create-a-mandal form to discover it wasn't for them.
//
// Four modes:
//   choose  — the two cards. Always the entry point.
//   create  — sign in if needed, then the mandal form. Guarded by the
//             interjection below.
//   invited — sign in with the invited address (auto-matched by
//             /continue), or type the code.
//   interject — post-auth on the create path only: they have a live invite
//             waiting, so offer it before letting them found a duplicate.
export function Signup() {
  const { session, appUser, loading, refreshAppUser } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // /continue signed them in, found no invite for that address, and sent
  // them here to say so rather than shrug. Arrives as router state so the
  // address never reaches the URL bar, history, or an access log.
  const { nomatch } = (useLocation().state ?? {}) as { nomatch?: string }
  const [mode, setMode] = useState<'choose' | 'create' | 'invited' | 'interject'>(
    nomatch !== undefined ? 'invited' : params.get('next') === 'create' ? 'create' : 'choose',
  )

  const [waiting, setWaiting] = useState<MyInvite[]>([])
  // A ref, not state: this only guards the lookup from firing twice and
  // nothing renders from it, so setting state for it would just cost a
  // render (and a cascading-render lint error) for no visible difference.
  const checkedInvites = useRef(false)
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState(false)
  const [mandalName, setMandalName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [cityVal, setCityVal] = useState('')
  const [stateVal, setStateVal] = useState('')
  const [address, setAddress] = useState('')
  const [slugHint, setSlugHint] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The duplicate-mandal guard. An invited person taps "Create a new mandal"
  // because it's the first card, and without this they'd found a second,
  // empty mandal and never see the one waiting for them. Runs once, only on
  // the create path, and only with a session — there's nothing to look up
  // before one exists.
  useEffect(() => {
    if (mode !== 'create' || !session || appUser || checkedInvites.current) return
    checkedInvites.current = true
    myPendingInvites()
      .then((invites) => {
        if (invites.length > 0) {
          setWaiting(invites)
          setMode('interject')
        }
      })
      // A failed lookup must not block founding a mandal — worst case they
      // create one and can still accept the invite afterwards.
      .catch(() => {})
  }, [mode, session, appUser])

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-stone-50 font-body text-stone-400">{strings.auth.loading}</div>
  }
  // Already a member: /continue owns the "where do I belong" decision.
  if (appUser) return <Navigate to="/continue" replace />

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

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = extractInviteToken(codeInput)
    if (!value) {
      setCodeError(true)
      return
    }
    // Stash before navigating: if /join sends them through an auth round
    // trip that comes back to the wrong URL, this is what survives it.
    stashInvite(value)
    navigate(`/join/${encodeURIComponent(value)}`)
  }

  if (mode === 'choose') {
    return (
      <AuthShell title={c.title} subtitle={c.subtitle}>
        <div className="flex flex-col gap-3">
          <ChoiceCard title={c.createTitle} body={c.createBody} cta={c.createCta} onClick={() => setMode('create')} />
          <ChoiceCard title={c.invitedTitle} body={c.invitedBody} cta={c.invitedCta} onClick={() => setMode('invited')} />
        </div>
      </AuthShell>
    )
  }

  if (mode === 'interject') {
    return (
      <AuthShell title={c.interjectTitle} subtitle={c.interjectBody(waiting[0].mandalName)}>
        <div className="flex flex-col gap-3">
          <button type="button" onClick={() => navigate('/continue')} className="rounded-xl bg-orange-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-colors hover:bg-stone-900">
            {c.interjectJoin(waiting[0].mandalName)}
          </button>
          <button
            type="button"
            onClick={() => setMode('create')}
            className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-bold text-stone-700 transition-colors hover:bg-stone-50"
          >
            {c.interjectCreate}
          </button>
        </div>
      </AuthShell>
    )
  }

  if (mode === 'invited') {
    return (
      <AuthShell title={c.invitedAuthTitle} subtitle={c.invitedAuthBody}>
        <div className="flex flex-col gap-5">
          {nomatch && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800">
              <p className="font-semibold">{c.noMatch(nomatch)}</p>
              <p className="mt-1 text-amber-700/80">{c.noMatchHelp}</p>
            </div>
          )}

          {/* Already signed in (they came from ?nomatch), so re-offering
              Google/email would just loop them through the same failed
              match — the code is the only thing left that can help. */}
          {!session && <AuthMethods redirectTo={`${window.location.origin}/continue`} />}

          <form onSubmit={submitCode} className="flex flex-col gap-2">
            <label htmlFor="invite-code" className="text-sm font-semibold text-stone-700">
              {session ? c.codeLabel : c.codeToggle}
            </label>
            <input
              id="invite-code"
              value={codeInput}
              onChange={(event) => {
                setCodeInput(event.target.value)
                setCodeError(false)
              }}
              placeholder={c.codePlaceholder}
              autoCapitalize="characters"
              autoComplete="off"
              className={`${inputCls} font-mono tracking-[0.14em] uppercase placeholder:tracking-normal placeholder:normal-case`}
            />
            <span className="text-xs leading-relaxed text-stone-500">{c.codeHelp}</span>
            {codeError && (
              <p role="alert" className="text-sm text-red-600">
                {c.codeInvalid}
              </p>
            )}
            <button
              type="submit"
              disabled={!codeInput.trim()}
              className="mt-1 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-colors hover:bg-stone-900 disabled:opacity-50"
            >
              {c.codeGo}
            </button>
          </form>

          <button type="button" onClick={() => setMode('choose')} className="text-center text-sm font-semibold text-stone-500 hover:text-stone-700">
            {c.back}
          </button>
        </div>
      </AuthShell>
    )
  }

  // mode === 'create'. Without a session there's nothing to attach a mandal
  // to, so sign in first and come back here via ?next=create.
  if (!session) {
    return (
      <AuthShell title={t.title} subtitle={t.intro}>
        <div className="flex flex-col gap-5">
          <AuthMethods redirectTo={`${window.location.origin}/signup?next=create`} />
          <button type="button" onClick={() => setMode('choose')} className="text-center text-sm font-semibold text-stone-500 hover:text-stone-700">
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
          {c.back}
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
