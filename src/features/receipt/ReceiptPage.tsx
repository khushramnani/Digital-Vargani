import { useEffect, useState, type CSSProperties } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { getPublicReceipt, parseInquiryContacts, type PublicReceipt } from '../../lib/db/receipt'
import { ReceiptStamp } from '../../components/ReceiptStamp'
import { formatINR } from '../../lib/money'
import { amountInWords } from '../../lib/amountWords'
import { receiptStrings, toLang, type Lang } from '../../lib/i18n/receipt'
import { formatForDisplay, normalizeToE164, waDigits } from '../../lib/phone'
import { strings } from '../../lib/strings'

type PageState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'found'; receipt: PublicReceipt }

// The Sanskrit invocation every Ganesh mandal opens with. Not localized (it is
// the same shloka in every language) and deliberately NOT letter-spaced —
// tracking breaks Devanagari conjuncts and matras (णेशा would fall apart).
const INVOCATION = '॥ ॐ श्री गणेशाय नमः ॥'

// Scalloped ticket edges (top + bottom), the bill-book "tear-off stub" look.
// Two radial-gradient mask layers punch semicircle notches along each edge; a
// center linear-gradient keeps the middle intact. drop-shadow (not box-shadow)
// is used on the same element so the shadow follows the notched silhouette.
const SCALLOP = 'radial-gradient(circle 9px at 9px 0,#0000 9px,#000 9.5px) top/18px 18px repeat-x,radial-gradient(circle 9px at 9px 100%,#0000 9px,#000 9.5px) bottom/18px 18px repeat-x,linear-gradient(#000 0 0) center/100% calc(100% - 18px) no-repeat'
const cardStyle: CSSProperties = {
  background: 'linear-gradient(178deg,#faf6ec 0%,#f4edda 100%)',
  // The scallop needs the `mask` SHORTHAND — the per-layer position/size/repeat
  // is invalid on the mask-image longhand, which is why straight edges rendered.
  WebkitMask: SCALLOP,
  mask: SCALLOP,
  filter: 'drop-shadow(0 14px 26px rgba(84,48,36,0.20))',
}

// Faint devotional watermark (a lotus/mandala, not a deity likeness) shown when
// the mandal hasn't uploaded a logo yet.
function PlaceholderWatermark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="50" cy="50" r="46" />
        <circle cx="50" cy="50" r="30" />
        {Array.from({ length: 8 }, (_, i) => {
          const angle = (i * Math.PI) / 4
          return <circle key={i} cx={50 + 30 * Math.cos(angle)} cy={50 + 30 * Math.sin(angle)} r="12" />
        })}
        <circle cx="50" cy="50" r="8" />
      </g>
    </svg>
  )
}

function formatReceiptDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// The receipt's hero amount reads cleaner without trailing .00 on whole
// rupees (the common case), but still shows paise when there's a fraction.
// Elsewhere in the app formatINR pins 2 digits for column consistency; here
// the single big number is the focal point.
function formatReceiptAmount(paise: number): string {
  return paise % 100 === 0 ? `₹${(paise / 100).toLocaleString('en-IN')}` : formatINR(paise)
}

function Divider() {
  return <div className="my-5 border-t border-dotted border-[#cdbb93]" />
}

// Traditional bill-book receipt numbering: PREFIX/YEAR/NNNN (e.g. VM/2026/0012).
// Year is taken in UTC so the string is stable regardless of the viewer's clock
// (Ganeshotsav is nowhere near a year boundary, so UTC vs IST never diverges in
// practice); the sequence is zero-padded to at least 4 digits.
function formatReceiptNumber(prefix: string, receiptNo: number, iso: string): string {
  const year = new Date(iso).getUTCFullYear()
  return `${prefix}/${year}/${String(receiptNo).padStart(4, '0')}`
}

// A resolved contact line. `name` is null for a phone with no PERSON attached
// (the president's number saved with no president_name) — the view renders the
// generic "For inquiries" label in that slot. We never substitute the mandal
// name, which would read as a person.
type ReceiptContact = { name: string | null; phone: string }

// Builds the receipt's inquiry-contact list (F6). The president shows purely on
// whether creator_phone came back: get_public_receipt now enforces the hide
// rule server-side (it nulls creator_phone when the president is hidden AND
// another contact exists, but keeps it when he's the sole contact), so the
// client just trusts the field — no hide_president_contact/extra.length logic
// here. Then up to two extra contacts; a contact needs a phone to appear.
function inquiryContactsFor(receipt: PublicReceipt): ReceiptContact[] {
  const extra: ReceiptContact[] = parseInquiryContacts(receipt.inquiry_contacts)
    .filter((c) => c.name.trim() && c.phone.trim())
    .slice(0, 2)
  const showPresident = !!receipt.creator_phone
  // Drop the old `?? mandal_name` fallback entirely. A blank/whitespace
  // president_name is treated as "no name" → name:null → generic label.
  const presidentName = receipt.president_name?.trim() ? receipt.president_name : null
  return [
    ...(showPresident ? [{ name: presidentName, phone: receipt.creator_phone! }] : []),
    ...extra,
  ]
}

// Small WhatsApp glyph for the inquiry-contact rows. aria-hidden — the parent
// <a> carries the accessible label. Inherits currentColor so it stays in the
// parchment palette rather than shouting WhatsApp green.
function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.97L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.16c-.24.68-1.42 1.32-1.95 1.36-.5.05-.95.24-3.2-.66-2.7-1.06-4.42-3.8-4.55-3.98-.13-.18-1.09-1.45-1.09-2.76 0-1.31.69-1.96.93-2.23a.98.98 0 0 1 .71-.33c.18 0 .36 0 .51.01.16.01.39-.06.6.46.24.58.82 2 .89 2.14.07.14.12.3.02.48-.09.18-.14.3-.28.46-.14.16-.29.36-.42.48-.14.14-.28.29-.12.56.16.28.72 1.18 1.54 1.91 1.06.95 1.95 1.24 2.23 1.38.28.14.44.12.6-.07.16-.18.69-.8.87-1.08.18-.28.36-.23.6-.14.24.09 1.53.72 1.79.85.26.14.44.2.5.31.06.12.06.66-.18 1.34z" />
    </svg>
  )
}

// The donor-facing receipt CARD — pure and self-contained: give it a resolved
// receipt + language and it renders the devotional bill-book, no fetching and
// no router hooks. Settings' "Preview donor receipt" renders this directly with
// a sample donation + the mandal's current branding.
export function ReceiptView({ receipt, lang }: { receipt: PublicReceipt; lang: Lang }) {
  const t = receiptStrings[lang]
  const mandalName = receipt.mandal_name
  const receiptNumber = formatReceiptNumber(receipt.receipt_prefix, receipt.receipt_no, receipt.created_at)
  const stampLabel = receipt.mode === 'cash' ? t.stampCash : t.stampOnline
  const contacts = inquiryContactsFor(receipt)

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e7ddc7] px-4 py-8 font-body">
      <div className="w-full max-w-md">
        <div lang={lang} className="relative overflow-hidden text-[#5a332b]" style={cardStyle}>
          {/* Watermark */}
          {receipt.logo_url ? (
            <img
              src={receipt.logo_url}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 m-auto h-60 w-60 object-contain opacity-[0.06]"
            />
          ) : (
            <PlaceholderWatermark className="pointer-events-none absolute inset-0 m-auto h-60 w-60 text-[#a8382a] opacity-[0.06]" />
          )}

          <div className="relative px-8 pt-9 pb-8">
            {/* Inner frame rule */}
            <div className="pointer-events-none absolute inset-3 border" style={{ borderColor: '#dccca6' }} />

            <div className="relative flex flex-col items-center text-center">
              {/* Invocation */}
              <p className="font-serif text-[15px] text-[#a8382a]">{INVOCATION}</p>
              <div className="mt-3 h-px w-24 bg-[#d6c39a]" />

              {/* Identity */}
              {receipt.logo_url && (
                <img
                  src={receipt.logo_url}
                  alt={mandalName}
                  className="mt-4 h-20 w-20 rounded-full border border-[#d6c39a] bg-white/50 object-contain p-1"
                />
              )}
              <h1 className="font-mark mt-3 text-[28px] leading-tight text-[#5a332b]">{mandalName}</h1>
              <p className="font-serif mt-1 text-[13px] text-[#8f7358] italic">
                {t.festivalSubtitle}
                {receipt.city ? ` · ${receipt.city}` : ''}
              </p>

              <p className="font-serif mt-4 rounded-md border border-[#c9b78d] px-4 py-1.5 text-[11px] tracking-[0.28em] text-[#7a6a3d] uppercase">
                {t.officialReceipt}
              </p>

              <Divider />

              {/* Receipt no + date */}
              <dl className="flex w-full items-end justify-between border-b border-dotted border-[#cdbb93] pb-2 text-left">
                <div>
                  <dt className="text-[10px] tracking-[0.14em] text-[#a38f6d] uppercase">{t.receiptNoLabel}</dt>
                  <dd className="font-mark mt-0.5 text-[15px] tabular-nums text-[#5a332b]">{receiptNumber}</dd>
                </div>
                <div className="text-right">
                  <dt className="text-[10px] tracking-[0.14em] text-[#a38f6d] uppercase">{t.dateLabel}</dt>
                  <dd className="font-mark mt-0.5 text-[15px] text-[#5a332b]">{formatReceiptDate(receipt.created_at)}</dd>
                </div>
              </dl>

              {receipt.voided && (
                <div role="alert" className="mt-5 w-full rounded-md border border-[#a8382a] bg-[#f6ebe9] px-4 py-3 text-[#8f2a20]">
                  <p className="font-serif font-bold tracking-wide uppercase">{t.voidedBanner}</p>
                  {receipt.void_reason && (
                    <p className="font-serif mt-1 text-sm">
                      {t.voidedReasonPrefix}
                      {receipt.void_reason}
                    </p>
                  )}
                </div>
              )}

              {/* Donor + amount */}
              <p className="font-serif mt-6 text-[13px] text-[#8f7358] italic">{t.receivedFrom}</p>
              <p className="font-mark mt-1 text-[26px] leading-tight text-[#5a332b]">{receipt.donor_name}</p>

              <p className="mt-6 text-[11px] tracking-[0.2em] text-[#a38f6d] uppercase">{t.contributionLabel}</p>
              <p className={`font-mark mt-1 text-[52px] leading-none ${receipt.voided ? 'text-[#a38f6d] line-through' : 'text-[#a8382a]'}`}>
                {formatReceiptAmount(receipt.amount_paise)}
              </p>
              <p className="font-serif mt-2 text-[13px] text-[#8f7358] italic">{t.amountInWordsLine(amountInWords(receipt.amount_paise))}</p>

              <Divider />

              {/* Signature + stamp */}
              <div className="flex w-full items-end justify-between gap-3 pt-1">
                <div className="flex min-w-0 flex-col items-start">
                  {receipt.signature_url && !receipt.voided ? (
                    <img src={receipt.signature_url} alt="" className="h-24 max-w-[220px] object-contain" />
                  ) : (
                    <div className="h-24" />
                  )}
                  <div className="mt-1 w-48 max-w-full border-t border-[#c9b78d] pt-1 text-left">
                    {receipt.president_name && (
                      <p className="font-mark text-[14px] leading-tight text-[#5a332b]">{receipt.president_name}</p>
                    )}
                    <p className="font-serif text-[12px] text-[#8f7358] italic">{t.signatureLabel}</p>
                  </div>
                </div>

                {!receipt.voided && <ReceiptStamp label={stampLabel} mode={receipt.mode === 'cash' ? 'cash' : 'online'} mandalName={mandalName} />}
              </div>

              {/* Inquiry contacts (F6) */}
              {contacts.length > 0 && (
                <div className="mt-6 w-full border-t border-dotted border-[#cdbb93] pt-3 text-center">
                  <p className="text-[10px] tracking-[0.18em] text-[#a38f6d] uppercase">{t.inquiryHeading}</p>
                  {contacts.map((c, i) => {
                    // Legacy rows may hold bare 10-digit numbers; normalize to
                    // E.164 first so tel:/wa.me/display are all consistent.
                    const e164 = normalizeToE164(c.phone)
                    return (
                      <div key={i} className="mt-2">
                        <p className="font-mark text-[13px] text-[#6b4a3a]">{c.name ?? t.inquiryForLabel}</p>
                        <p className="mt-0.5 flex items-center justify-center gap-2 text-[13px]">
                          <a
                            href={`tel:${e164}`}
                            className="font-mark text-[#6b4a3a] underline decoration-dotted decoration-[#a8382a] underline-offset-4"
                          >
                            {formatForDisplay(e164)}
                          </a>
                          <a href={`https://wa.me/${waDigits(e164)}`} aria-label="WhatsApp" className="text-[#6b4a3a]">
                            <WhatsAppGlyph className="h-4 w-4" />
                          </a>
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer blessing, on the page rather than the paper */}
        <p className="font-serif mx-auto mt-5 max-w-sm text-center text-[12px] leading-relaxed text-[#8a6a4e] italic">
          {t.footerNote}
        </p>
      </div>
    </main>
  )
}

// Public, unauthenticated route (/r/:public_token) — no RequireRole guard, no
// AuthProvider dependency. This is the donor-facing devotional world, styled
// like a stamped paper vargani receipt, deliberately warmer and more
// traditional than the utilitarian volunteer/admin screens. Owns the URL param,
// fetch and loading/not-found states; the card itself is <ReceiptView />.
export function ReceiptPage() {
  const { public_token } = useParams<{ public_token: string }>()
  const [searchParams] = useSearchParams()
  const lang = toLang(searchParams.get('lang'))
  const t = receiptStrings[lang]
  const [state, setState] = useState<PageState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    async function load() {
      // F4: human-friendly URLs are `<receiptNo>-<token>` — strip the cosmetic
      // numeric prefix and look up by the bare token. Old bare-token links have
      // no such prefix and pass through unchanged.
      const token = public_token?.replace(/^\d+-/, '')
      if (!token) {
        if (active) setState({ status: 'not-found' })
        return
      }
      try {
        const receipt = await getPublicReceipt(token)
        if (!active) return
        if (!receipt) {
          setState({ status: 'not-found' })
          return
        }
        setState({ status: 'found', receipt })
        // v3: canonicalize the cosmetic "<receiptNo>-" prefix in place. A wrong
        // number, or a bare token missing it, is rewritten to
        // /r/<receipt_no>-<token> — purely cosmetic (replaceState keeps the
        // ?lang= query and does NOT re-run the router/this fetch).
        const canonicalPath = `/r/${receipt.receipt_no}-${token}`
        if (window.location.pathname !== canonicalPath) {
          window.history.replaceState(null, '', canonicalPath + window.location.search)
        }
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
      <main className="flex min-h-screen items-center justify-center bg-[#e7ddc7] px-4">
        <p className="font-serif text-[#8f7358]">{strings.auth.loading}</p>
      </main>
    )
  }

  if (state.status === 'not-found') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#e7ddc7] px-4 text-center">
        <p className="font-serif text-[#5a332b]">{t.notFound}</p>
      </main>
    )
  }

  return <ReceiptView receipt={state.receipt} lang={lang} />
}
