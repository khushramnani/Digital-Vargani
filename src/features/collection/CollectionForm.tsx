import { useState, useEffect, useRef, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { getDonations, type Donation } from '../../lib/db/donations'
import { getDonationSources, getMandal } from '../../lib/db/config'
import { DEFAULT_SOURCES, sourceLabel } from '../../lib/sources'
import { validateDonationInput, type DonationMode, type DonationValidationErrors } from '../../lib/validation/donation'
import { toPaise, formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { sendReceiptSms, sendReceiptWhatsApp, buildReceiptMessage, receiptUrl } from './send'
import { LanguagePicker } from './LanguagePicker'
import { useReceiptLang } from './useReceiptLang'
import { ModeGlyph } from './ModeGlyph'
import { SourcesSheet } from './SourcesSheet'
import { enqueueDonation, syncOutboxItem } from '../../lib/queue/sync'
import { isAdminRole } from '../../lib/roles'
import { AppShell } from '../../components/AppShell'
import { PhoneInput } from '../../components/PhoneInput'
import { VolunteerTabBar } from './VolunteerTabBar'
import { Money } from '../../components/console'
import {
  eyebrow,
  pill,
  modeTile,
  ctaOrange,
  ctaMuted,
  ctaInk,
  consoleFieldTall,
  errorText,
  navPill,
} from '../../components/ui'

const t = strings.collection

const MODES: DonationMode[] = ['cash', 'upi', 'bank']
const MODE_LABEL: Record<DonationMode, string> = { cash: t.modeCash, upi: t.modeUpi, bank: t.modeBank }

// The volunteer's last source pick sticks: they often work a whole lane of shops
// in one go. The key predates custom sources (v4 stored a slug); it now holds
// the source NAME, and a name no longer in the mandal's list simply falls back
// to the first source, so an old slug in storage is self-healing.
const SOURCE_KEY = 'vm:lastCategory'
function readRememberedSource(): string {
  try {
    return localStorage.getItem(SOURCE_KEY) ?? ''
  } catch {
    return ''
  }
}

// Auspicious quick-amount chips (design): tapping fills the Amount field.
const QUICK_AMOUNTS = [101, 251, 501, 1100, 2100]

// The volunteer's last-used send channel is remembered so the send card
// emphasises it as the primary button. Default (and every fresh device) is
// SMS — the zero-cost, arrives-from-you channel. Nothing sends on its own:
// the volunteer taps a button (audit v3 §2.1 — no auto-fire).
const CHANNEL_KEY = 'vm:lastSendChannel'
type SendChannel = 'sms' | 'whatsapp'
function readChannel(): SendChannel {
  try {
    return localStorage.getItem(CHANNEL_KEY) === 'whatsapp' ? 'whatsapp' : 'sms'
  } catch {
    return 'sms'
  }
}

// The product's primary screen (SPEC.md): name/phone/amount/mode/source in, a
// donation row out. Routed at /collect behind RequireRole role=['owner',
// 'admin', 'volunteer'] (src/app/router.tsx) — both an admin and a volunteer
// collect the same way. Every submit lands in the Dexie outbox first
// (src/lib/queue), then an immediate sync either completes right away (online)
// or leaves it queued (offline).
//
// Redesign 2026-08-18: the design's collect screen — eyebrow'd field groups,
// 86px payment tiles with drawn marks, a source chip row backed by the mandal's
// own editable list (§1), an explicit "no phone" path (§2), and a full-screen
// confirmation instead of the old bottom sheet, so a stale filled form is never
// left sitting behind the send choice.
export function CollectionForm() {
  const { appUser } = useAuth()
  const [donorName, setDonorName] = useState('')
  const [donorPhone, setDonorPhone] = useState('')
  const [skipPhone, setSkipPhone] = useState(false)
  const [amountRupees, setAmountRupees] = useState('')
  const [mode, setMode] = useState<DonationMode | ''>('')
  const [sources, setSources] = useState<string[]>([...DEFAULT_SOURCES])
  // Read once, not on every render: the remembered pick only matters until the
  // volunteer taps a chip in this session.
  const [rememberedSource] = useState(readRememberedSource)
  const [pickedSource, setPickedSource] = useState('')
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [mandalId, setMandalId] = useState<string | null>(null)
  const [errors, setErrors] = useState<DonationValidationErrors>({})
  // Focus returns here after the confirmation clears, so the next entry starts
  // immediately (§6 — the "log another" loop, without scrolling).
  const donorNameRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastDonation, setLastDonation] = useState<Donation | null>(null)
  const [savedOffline, setSavedOffline] = useState(false)
  const [channel, setChannel] = useState<SendChannel>(readChannel)
  const [today, setToday] = useState<{ totalPaise: number; count: number }>({ totalPaise: 0, count: 0 })
  const [lang, setLang] = useReceiptLang()

  const isAdmin = isAdminRole(appUser?.role ?? '')
  const isVolunteer = appUser?.role === 'volunteer'

  // The mandal's source list. getDonationSources() is the RPC every role can
  // call; an admin additionally needs the mandal id, because rename/remove go
  // through updateMandal (admin-only RLS) rather than through an RPC.
  useEffect(() => {
    if (!appUser) return
    let active = true
    getDonationSources()
      .then((list) => {
        if (active && list.length > 0) setSources(list)
      })
      .catch(() => {})
    if (isAdminRole(appUser.role)) {
      getMandal()
        .then((m) => {
          if (active) setMandalId(m.id)
        })
        .catch(() => {})
    }
    return () => {
      active = false
    }
  }, [appUser])

  // The selection is DERIVED, not stored: resolve the wanted name against the
  // live list on every render. That is what keeps it honest through the two
  // moments the list changes underneath it — the RPC answering (the chip row
  // starts on DEFAULT_SOURCES so the form is usable immediately) and an admin
  // renaming or removing a source in the sheet. Either way an unresolvable name
  // falls back to the first source, so a submit always carries one the mandal
  // actually has, and no effect has to chase the state.
  const wantedSource = pickedSource || rememberedSource
  const source =
    sources.find((s) => s.toLowerCase() === sourceLabel(wantedSource).toLowerCase()) ?? sources[0] ?? ''

  // Personal daily total for the greeting chip — this volunteer's own,
  // non-voided donations dated today. RLS already scopes getDonations to the
  // caller's rows; the client-side filter by id/date is belt-and-braces.
  useEffect(() => {
    if (appUser?.role !== 'volunteer') return
    const uid = appUser.id
    let active = true
    getDonations()
      .then((all) => {
        if (!active) return
        const todayStr = new Date().toDateString()
        const mine = all.filter(
          (d) => d.collected_by === uid && !d.voided && new Date(d.created_at).toDateString() === todayStr,
        )
        setToday({ totalPaise: mine.reduce((sum, d) => sum + d.amount_paise, 0), count: mine.length })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [appUser])

  function resetForm() {
    setDonorName('')
    setDonorPhone('')
    setSkipPhone(false)
    setAmountRupees('')
    setMode('')
    setErrors({})
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLastDonation(null)
    setSavedOffline(false)

    const result = validateDonationInput({ donorName, donorPhone, amountRupees, mode, skipPhone })
    setErrors(result.errors)
    // collectedBy is never form-editable — it always comes from the session's
    // acting user, resolved once here at submit time.
    if (!result.valid || !appUser) return

    setSubmitting(true)
    try {
      // Always lands locally first (Dexie write, can't fail due to network)
      // — this is what makes "no data loss with network off" true.
      const { localId } = await enqueueDonation({
        donorName: donorName.trim(),
        // §2: a skipped phone is stored as nothing at all, not as whatever was
        // half-typed before the volunteer flipped the toggle.
        donorPhone: skipPhone ? '' : donorPhone.trim(),
        amountPaise: toPaise(Number(amountRupees)),
        mode: mode as DonationMode,
        category: source,
        collectedBy: appUser.id,
      })
      // Immediate sync attempt — online this completes in about the time the
      // old direct insert did, so the online-path UX is unchanged.
      const synced = await syncOutboxItem(localId)
      if (synced) {
        // No auto-fire (audit v3 §2.1): show the confirmation and let the
        // volunteer tap SMS or WhatsApp. The old auto-open raced the OS
        // composer onto the screen before the choice ever painted, and
        // marked the donation "sent" even when the composer was cancelled.
        setLastDonation(synced)
      } else {
        // Offline (or a transient failure) — safely queued in Dexie, will sync
        // once connectivity returns. No receipt number and no send attempt:
        // there's no public_token until the row has actually synced.
        setSavedOffline(true)
      }
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  function selectSource(name: string) {
    setPickedSource(name)
    try {
      localStorage.setItem(SOURCE_KEY, name)
    } catch {
      /* private mode / storage disabled — the pick still applies this session */
    }
  }

  // §2: flipping the toggle clears the number, so a half-typed value can never
  // ride along on a donation the volunteer said has no phone.
  function toggleSkipPhone() {
    setSkipPhone((s) => !s)
    setDonorPhone('')
    setErrors((e) => ({ ...e, donorPhone: undefined }))
  }

  // Dismissing the confirmation returns to a blank form with focus on
  // donor-name, so logging five in a row never needs a scroll or a manual clear.
  function backToForm() {
    setLastDonation(null)
    setSavedOffline(false)
    resetForm()
    requestAnimationFrame(() => donorNameRef.current?.focus())
  }

  // Tapping a channel remembers it, fires that channel's send flow (which marks
  // the donation sent — tap-only, audit v3), then returns to the form.
  function sendVia(ch: SendChannel) {
    if (!lastDonation) return
    try {
      localStorage.setItem(CHANNEL_KEY, ch)
    } catch {
      /* private mode / storage disabled — the send still fires */
    }
    setChannel(ch)
    if (ch === 'whatsapp') sendReceiptWhatsApp(lastDonation, lang)
    else sendReceiptSms(lastDonation, lang)
    backToForm()
  }

  const amountPaise = amountRupees.trim() === '' ? 0 : toPaise(Number(amountRupees))
  // The design's enablement rule, plus the mode requirement this app keeps:
  // payment mode drives every volunteer's cash-in-hand, so a UPI donation must
  // never be bookable as cash by default.
  const canRecord =
    donorName.trim() !== '' &&
    Number.isFinite(amountPaise) &&
    amountPaise > 0 &&
    mode !== '' &&
    (skipPhone || donorPhone.trim() !== '')

  const phoneNote = skipPhone ? t.phoneNoteSkipped : donorPhone.trim() ? t.phoneNoteGood : t.phoneNoteDefault

  return (
    <AppShell
      title={t.title}
      subtitle={isVolunteer ? (appUser?.name ? `${t.greetingPrefix}${appUser.name}` : t.greetingFallback) : undefined}
      back={isAdmin ? { to: '/admin', label: t.backToDashboard } : undefined}
      actions={
        isVolunteer ? (
          <span className="flex-none rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700 tabular-nums">
            {formatINR(today.totalPaise)} {t.todayLabel} · {today.count}
            {t.donorsSuffix}
          </span>
        ) : undefined
      }
    >
      {/* The design's three collect-flow pills, replacing the old five-chip
          admin quick-nav. Admin-only: a volunteer reaches the same two places
          from their bottom tab bar, and two links to one destination on one
          screen is noise, not navigation. */}
      {!isVolunteer && (
        <nav className="-mx-1 flex gap-[7px] overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className={navPill(true)}>{t.newDonation}</span>
          <Link to="/collect/pending" className={navPill(false)}>
            {t.pendingSendLink}
          </Link>
          <Link to="/collect/history" className={navPill(false)}>
            {t.myCollections}
          </Link>
        </nav>
      )}

      {lastDonation || savedOffline ? (
        <Confirmation
          donation={lastDonation}
          lang={lang}
          channel={channel}
          onSend={sendVia}
          onLogAnother={backToForm}
          isAdmin={isAdmin}
        />
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col">
          <label htmlFor="donor-name" className={`${eyebrow} mb-2`}>
            {t.donorNameLabel}
          </label>
          <input
            id="donor-name"
            ref={donorNameRef}
            value={donorName}
            placeholder={t.donorNamePlaceholder}
            onChange={(e) => setDonorName(e.target.value)}
            className={consoleFieldTall}
          />
          {errors.donorName && (
            <p role="alert" className={`mt-1.5 ${errorText}`}>
              {errors.donorName}
            </p>
          )}

          <div className="mt-[18px] mb-2 flex items-baseline gap-2">
            <span className={eyebrow}>{t.phoneLabel}</span>
            <span className="flex-1" />
            <span className="text-[10.5px] font-semibold text-stone-400">{phoneNote}</span>
          </div>

          {skipPhone ? (
            <>
              {/* §2: the design's warm notice. It states what is and isn't lost,
                  because "no receipt" is the one thing a donor might expect. */}
              <div className="flex items-start gap-[11px] rounded-[14px] border-[1.5px] border-warm-border bg-warm p-[13px]">
                <span
                  aria-hidden="true"
                  className="font-display flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-warm-border text-[13px] font-bold text-warm-ink"
                >
                  !
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-warm-ink">{t.skipPhoneTitle}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-warm-body text-pretty">{t.skipPhoneBody}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleSkipPhone}
                aria-pressed={true}
                className="mt-[9px] h-8 self-start rounded-full border border-stone-200 bg-white px-3 text-[11.5px] font-bold text-stone-600 transition-colors hover:border-stone-900 hover:text-stone-900"
              >
                {t.unskipPhoneToggle}
              </button>
            </>
          ) : (
            <>
              {/* PhoneInput, not the design's fixed "IN +91" box: v4 §3 replaced
                  exactly that, because a bare field let the WhatsApp link
                  silently assume +91 for any 10-digit number. */}
              <PhoneInput
                id="donor-phone"
                value={donorPhone}
                onChange={setDonorPhone}
                label={t.donorPhoneLabel}
                placeholder={t.phonePlaceholder}
                hideLabel
                tall
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-stone-400 text-pretty">{t.phoneReceiptHint}</p>
              {errors.donorPhone && (
                <p role="alert" className={`mt-1.5 ${errorText}`}>
                  {errors.donorPhone}
                </p>
              )}
              <button
                type="button"
                onClick={toggleSkipPhone}
                aria-pressed={false}
                className="mt-[9px] h-8 self-start rounded-full border border-dashed border-stone-300 bg-stone-50 px-3 text-[11.5px] font-bold text-stone-600 transition-colors hover:border-stone-900 hover:text-stone-900"
              >
                {t.skipPhoneToggle}
              </button>
            </>
          )}

          <label htmlFor="donor-amount" className={`${eyebrow} mt-[18px] mb-2`}>
            {t.amountLabel}
          </label>
          <div className="flex h-16 items-center rounded-[16px] border-[1.5px] border-stone-200 bg-white px-[15px] focus-within:border-orange-500">
            <span aria-hidden="true" className="font-display text-[27px] font-extrabold text-stone-900">
              ₹
            </span>
            <input
              id="donor-amount"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={amountRupees}
              placeholder="0"
              onChange={(e) => setAmountRupees(e.target.value)}
              className="font-display ml-2 min-w-0 flex-1 bg-transparent text-[27px] font-extrabold tabular-nums text-stone-900 outline-none placeholder:text-stone-300"
            />
          </div>
          {errors.amountRupees && (
            <p role="alert" className={`mt-1.5 ${errorText}`}>
              {errors.amountRupees}
            </p>
          )}
          <div className="-mx-4 mt-[9px] flex gap-[7px] overflow-x-auto px-4 pt-px pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {QUICK_AMOUNTS.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setAmountRupees(String(amt))}
                className={`${pill(amountRupees === String(amt))} tabular-nums`}
              >
                ₹{amt.toLocaleString('en-IN')}
              </button>
            ))}
          </div>

          <span className={`${eyebrow} mt-[18px] mb-2`}>{t.howTheyPaidLabel}</span>
          <div role="group" aria-label={t.howTheyPaidLabel} className="flex gap-2">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={modeTile(mode === m)}
              >
                <ModeGlyph mode={m} />
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          {errors.mode && (
            <p role="alert" className={`mt-1.5 ${errorText}`}>
              {errors.mode}
            </p>
          )}

          {/* §1: the mandal's own source list, not a hardcoded three. Renaming
              or removing one never touches a donation already recorded. */}
          <div className="mt-[18px] mb-2 flex items-baseline gap-2">
            <span className={eyebrow}>{strings.sources.label}</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setSourcesOpen(true)}
              className="text-[11px] font-bold text-amber-700 transition-colors hover:text-orange-600"
            >
              {strings.sources.manage}
            </button>
          </div>
          <div role="group" aria-label={strings.sources.label} className="flex flex-wrap gap-[7px]">
            {sources.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={source === name}
                onClick={() => selectSource(name)}
                className={pill(source === name)}
              >
                {name}
              </button>
            ))}
          </div>

          {/* No number, no receipt to translate — the picker would be choosing a
              language for a message that is never composed. */}
          {!skipPhone && (
            <div className="mt-[18px]">
              <LanguagePicker lang={lang} onChange={setLang} label={t.languageLabel} />
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !canRecord}
            className={`mt-[22px] ${canRecord && !submitting ? ctaOrange : ctaMuted}`}
          >
            {submitting ? t.submitting : skipPhone ? t.submitButtonNoReceipt : t.submitButton}
          </button>
          <p className="mt-[9px] text-center text-[11px] leading-relaxed text-stone-400 text-pretty">
            {skipPhone ? t.submitHintNoReceipt : t.submitHint}
          </p>

          {error && (
            <p role="alert" className={`mt-2 ${errorText}`}>
              {error}
            </p>
          )}
        </form>
      )}

      <SourcesSheet
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        sources={sources}
        mandalId={mandalId}
        canEdit={isAdmin}
        onChange={setSources}
      />

      {isVolunteer && (
        <>
          <div aria-hidden="true" className="h-16" />
          <VolunteerTabBar />
        </>
      )}
    </AppShell>
  )
}

// The design's post-save screen: it REPLACES the form rather than sitting over
// it, so there is no stale filled form behind the send choice inviting a
// double-submit (the problem audit v3 §6 solved with a sheet; a full swap solves
// it outright). `donation` is null only for the offline path, which has no
// receipt number and nothing to send yet.
function Confirmation({
  donation,
  lang,
  channel,
  onSend,
  onLogAnother,
  isAdmin,
}: {
  donation: Donation | null
  lang: Parameters<typeof buildReceiptMessage>[1]
  channel: SendChannel
  onSend: (ch: SendChannel) => void
  onLogAnother: () => void
  isAdmin: boolean
}) {
  const hasPhone = !!donation?.donor_phone

  const sendButton = (ch: SendChannel, primary: boolean) => (
    <button
      key={ch}
      type="button"
      onClick={() => onSend(ch)}
      className={
        primary
          ? 'h-[50px] w-full rounded-[14px] border-[1.5px] border-green-200 bg-green-50 text-sm font-bold text-green-800 transition-colors hover:bg-green-100'
          : 'h-[46px] w-full rounded-[13px] border border-stone-200 bg-white text-[13px] font-bold text-stone-700 transition-colors hover:border-stone-900'
      }
    >
      {ch === 'whatsapp' ? t.sendReceiptWhatsAppButton : t.sendReceiptSmsButton}
    </button>
  )

  return (
    <div className="animate-fade-up flex flex-col pt-2">
      <div className="text-center">
        <div
          aria-hidden="true"
          className="mx-auto flex h-[60px] w-[60px] items-center justify-center rounded-full border-[1.5px] border-green-200 bg-green-50 text-2xl font-bold text-green-600"
        >
          {donation ? '✓' : '⋯'}
        </div>
        <h2 className="font-display mt-3.5 text-[21px] font-extrabold tracking-[-0.02em] text-stone-900">
          {donation ? `${t.doneTitlePrefix}#${donation.receipt_no}` : t.savedOnPhone}
        </h2>
        <p className="mt-1 text-[12.5px] font-medium text-stone-400">
          {donation
            ? hasPhone
              ? `${t.doneReadyPrefix}${donation.donor_phone}`
              : t.doneNoReceiptSub
            : t.savedOffline}
        </p>
      </div>

      {donation && (
        <div className="mt-5 rounded-[18px] border border-stone-200 bg-white p-[15px] shadow-[0_1px_2px_rgba(28,25,23,.04)]">
          <div className="flex items-baseline gap-2.5">
            <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-stone-900">{donation.donor_name}</span>
            <Money
              paise={donation.amount_paise}
              className="font-display flex-none text-[19px] font-extrabold tabular-nums"
            />
          </div>
          <p className="mt-0.5 text-[11.5px] font-medium text-stone-400">
            {strings.collection[`mode${donation.mode === 'upi' ? 'Upi' : donation.mode === 'bank' ? 'Bank' : 'Cash'}`]} ·{' '}
            {sourceLabel(donation.category)}
          </p>
        </div>
      )}

      {donation && hasPhone && (
        <>
          {/* The exact text that goes out — one source of truth (send.ts). */}
          <div className="mt-2.5 rounded-[13px] bg-stone-100 p-3">
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-stone-400 uppercase">{t.smsPreviewLabel}</p>
            <p className="text-[13px] break-words text-stone-600">{buildReceiptMessage(donation, lang)}</p>
          </div>
          {/* Both channels every time; the last-used one is the primary. */}
          <div className="mt-2.5 flex flex-col gap-2">
            {channel === 'whatsapp'
              ? [sendButton('whatsapp', true), sendButton('sms', false)]
              : [sendButton('sms', true), sendButton('whatsapp', false)]}
          </div>
          <button
            type="button"
            onClick={() =>
              window.open(receiptUrl(donation.receipt_no, donation.public_token, lang), '_blank', 'noopener')
            }
            className="mt-3 text-sm font-semibold text-orange-600 transition-colors hover:text-orange-700"
          >
            {t.previewReceiptButton}
          </button>
        </>
      )}

      {donation && !hasPhone && (
        <p className="mt-3 rounded-[13px] border border-dashed border-stone-200 bg-stone-50 px-[13px] py-3 text-center text-[11.5px] leading-relaxed text-stone-500 text-pretty">
          {t.doneNoReceiptNote}
        </p>
      )}

      <button type="button" onClick={onLogAnother} className={`mt-3.5 ${ctaInk}`}>
        {t.logAnother}
      </button>
      {isAdmin && (
        <Link
          to="/admin"
          className="mt-2 flex h-11 w-full items-center justify-center text-[13px] font-bold text-stone-500 transition-colors hover:text-stone-900"
        >
          {t.backToConsole}
        </Link>
      )}
    </div>
  )
}
