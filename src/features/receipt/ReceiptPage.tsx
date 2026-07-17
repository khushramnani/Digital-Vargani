import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { getPublicReceipt, type PublicReceipt } from '../../lib/db/receipt'
import { StampGraphic } from '../../components/StampGraphic'
import { formatINR } from '../../lib/money'
import { receiptStrings, toLang } from '../../lib/i18n/receipt'
import { strings } from '../../lib/strings'

type PageState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'found'; receipt: PublicReceipt }

// Generic devotional placeholder (a simple lotus/mandala, not a specific
// deity likeness) used when the mandal hasn't uploaded a real logo yet —
// see Task 6's settings screen for where that upload happens.
function PlaceholderWatermark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="50" cy="50" r="46" />
        <circle cx="50" cy="50" r="30" />
        {Array.from({ length: 8 }, (_, i) => {
          const angle = (i * Math.PI) / 4
          const x = 50 + 30 * Math.cos(angle)
          const y = 50 + 30 * Math.sin(angle)
          return <circle key={i} cx={x} cy={y} r="12" />
        })}
        <circle cx="50" cy="50" r="8" />
      </g>
    </svg>
  )
}

function formatReceiptDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Public, unauthenticated route (/r/:public_token) — no RequireRole guard,
// no AuthProvider dependency on the result. Per SPEC.md's "two distinct
// worlds" note, this is the traditional/devotional/warm visual world,
// intentionally different from the utilitarian volunteer/admin screens.
export function ReceiptPage() {
  const { public_token } = useParams<{ public_token: string }>()
  const [searchParams] = useSearchParams()
  // The donor's language. toLang() falls back to English for anything
  // unrecognised — this is a URL a donor could have mangled. Declared before
  // the early returns because the not-found branch reads t.notFound too.
  const lang = toLang(searchParams.get('lang'))
  const t = receiptStrings[lang]
  // ponytail: initial value covers the mount case; a same-instance token
  // swap (e.g. an in-app link from one /r/:x to another /r/:y without a
  // full navigation) would show stale content until the new fetch
  // resolves rather than an intermediate loading flash. Not a real path
  // in this app — receipt links are always opened fresh — so it's not
  // worth an extra effect-triggered reset render.
  const [state, setState] = useState<PageState>({ status: 'loading' })

  useEffect(() => {
    let active = true

    async function load() {
      if (!public_token) {
        if (active) setState({ status: 'not-found' })
        return
      }

      try {
        // One round trip, not two: get_public_receipt joins the receipt's
        // own mandal, so its branding arrives with it and can never be
        // another mandal's.
        const receipt = await getPublicReceipt(public_token)
        if (!active) return
        setState(receipt ? { status: 'found', receipt } : { status: 'not-found' })
      } catch {
        if (active) setState({ status: 'not-found' })
      }
    }

    load()

    return () => {
      active = false
    }
  }, [public_token])

  if (state.status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-stone-400">{strings.auth.loading}</p>
      </main>
    )
  }

  if (state.status === 'not-found') {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <p className="text-stone-600">{t.notFound}</p>
      </main>
    )
  }

  // No appName fallback: the RPC joins mandals, and a receipt cannot exist
  // without one.
  const { receipt } = state
  const mandalName = receipt.mandal_name
  const receiptNumber = `${receipt.receipt_prefix}-${String(receipt.receipt_no).padStart(6, '0')}`
  const stampLabel = receipt.mode === 'cash' ? t.stampCash : t.stampOnline

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-10">
      <div
        lang={lang}
        className="relative w-full max-w-md overflow-hidden rounded-lg border-4 border-dashed border-amber-800/40 bg-gradient-to-br from-amber-50 to-amber-100 p-8 text-stone-800 shadow-md"
      >
        {receipt.logo_url ? (
          <img
            src={receipt.logo_url}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 m-auto h-56 w-56 object-contain opacity-10"
          />
        ) : (
          <PlaceholderWatermark className="pointer-events-none absolute inset-0 m-auto h-56 w-56 text-amber-800 opacity-10" />
        )}

        <div className="relative flex flex-col items-center gap-4 text-center">
          <h1 className="text-lg font-semibold tracking-wide text-amber-900 uppercase">{mandalName}</h1>

          {receipt.voided && (
            <div role="alert" className="w-full rounded border-2 border-red-700 bg-red-50 p-3 text-red-800">
              <p className="font-bold uppercase">{t.voidedBanner}</p>
              {receipt.void_reason && (
                <p className="text-sm">
                  {t.voidedReasonPrefix}
                  {receipt.void_reason}
                </p>
              )}
            </div>
          )}

          <p className="text-4xl font-bold text-amber-950">{formatINR(receipt.amount_paise)}</p>

          <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-1 text-left text-sm">
            <dt className="text-stone-500">{t.donorLabel}</dt>
            <dd>{receipt.donor_name}</dd>
            <dt className="text-stone-500">{t.receiptNoLabel}</dt>
            <dd>{receiptNumber}</dd>
            <dt className="text-stone-500">{t.dateLabel}</dt>
            <dd>{formatReceiptDate(receipt.created_at)}</dd>
          </dl>

          {!receipt.voided && <StampGraphic label={stampLabel} variant={receipt.mode === 'cash' ? 'cash' : 'online'} />}

          {receipt.signature_url && !receipt.voided && (
            <div className="mt-2 flex flex-col items-center gap-1">
              <img src={receipt.signature_url} alt={t.signatureLabel} className="h-12 object-contain" />
              <p className="text-xs text-stone-500">{t.signatureLabel}</p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
