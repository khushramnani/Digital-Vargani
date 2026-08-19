import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  getMandal,
  updateMandal,
  uploadMandalAsset,
  type MandalAssetKind,
  type Mandal,
} from '../../lib/db/config'
import { LANGS, toLang, type Lang } from '../../lib/i18n/receipt'
import { toPaise, toRupees, formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { CityTypeahead } from '../../components/CityTypeahead'
import { PhoneInput } from '../../components/PhoneInput'
import { formatForDisplay, normalizeToE164 } from '../../lib/phone'
import { HowToSheet } from '../admin/HowToSheet'
import { consoleField, ctaMuted, ctaOrange, eyebrow, infoRound, panelTitle, pill } from '../../components/ui'
import { ReceiptView } from '../receipt/ReceiptPage'
import { parseInquiryContacts, type InquiryContact, type PublicReceipt } from '../../lib/db/receipt'

// F5: the four transparency-report audiences, shared with strings.transparencyVisibility.
const VISIBILITIES = ['public', 'members', 'admins', 'disabled'] as const
type Visibility = (typeof VISIBILITIES)[number]
const toVisibility = (v: string): Visibility =>
  (VISIBILITIES as readonly string[]).includes(v) ? (v as Visibility) : 'public'

const t = strings.mandalConfig

// The design's collapsible section: title + a one-line summary of what is inside,
// so a closed accordion still tells you what it holds. Identity opens by default
// (it is what a new mandal fills in first); the rest stay shut, because five open
// forms on a phone is a scroll, not a settings screen.
function Accordion({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string
  summary: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-[18px] border border-stone-200 bg-white shadow-[0_1px_2px_rgba(28,25,23,.04)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 p-[15px] text-left"
      >
        <span className="min-w-0 flex-1">
          <span className={`block ${panelTitle} text-[15px]`}>{title}</span>
          <span className="mt-0.5 block truncate text-[11.5px] font-medium text-stone-400">{summary}</span>
        </span>
        <span aria-hidden="true" className="flex-none text-[13px] font-semibold text-stone-400">
          {open ? '⌃' : '⌄'}
        </span>
      </button>
      {open && <div className="px-[15px] pb-4">{children}</div>}
    </section>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  // help lives OUTSIDE the <label> so it doesn't become part of the control's
  // accessible name (getByLabelText would otherwise see "Bank opening (₹)₹0").
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-stone-700">{label}</span>
        {children}
      </label>
      {help && <span className="text-[11px] leading-relaxed font-medium text-stone-400">{help}</span>}
    </div>
  )
}

function ImageField({
  id,
  label,
  help,
  url,
  isUploading,
  onSelect,
}: {
  id: string
  label: string
  help: string
  url: string | null
  isUploading: boolean
  onSelect: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-xl border border-hairline bg-stone-50">
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-contain" />
        ) : (
          <span aria-hidden="true" className="text-lg text-stone-300">
            ＋
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {/* htmlFor keeps the field name the input's accessible label (the styled
            button beside it is a second, wrapping label showing Change/Upload). */}
        <label htmlFor={id} className="text-[12.5px] font-semibold text-stone-700">
          {label}
        </label>
        <p className="mt-px text-[11px] font-medium text-stone-400">{isUploading ? t.uploading : help}</p>
      </div>
      <label className="h-[34px] flex-none cursor-pointer rounded-[10px] border border-stone-200 bg-white px-3.5 text-xs leading-[34px] font-bold text-stone-700 transition-colors hover:border-stone-900">
        {url ? t.changeImage : t.uploadImage}
        <input id={id} type="file" accept="image/*" className="sr-only" onChange={onSelect} />
      </label>
    </div>
  )
}

// Admin-only content body (rendered inside AdminLayout's console frame at
// /admin/settings). Single form over the admin's own mandals row + its
// Cloudinary-backed assets — RLS scopes the row, so there's no tenant filter
// here. No member management on this screen, that's settings/members.tsx; and no
// expense categories, those moved to the Expenses tab (plan 2026-08-18 §3).
export function MandalConfigContent() {
  const [loading, setLoading] = useState(true)
  // Held in state because updateMandal and uploadMandalAsset both need it.
  const [mandalId, setMandalId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [cityVal, setCityVal] = useState('')
  const [stateVal, setStateVal] = useState('')
  const [address, setAddress] = useState('')
  const [creatorPhone, setCreatorPhone] = useState('')
  const [presidentName, setPresidentName] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [contacts, setContacts] = useState<InquiryContact[]>([])
  const [hidePresident, setHidePresident] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [howToOpen, setHowToOpen] = useState(false)
  // Not editable here, but the receipt preview + numbering need it.
  const [receiptPrefix, setReceiptPrefix] = useState('VM')
  const [upiVpa, setUpiVpa] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [upiQrUrl, setUpiQrUrl] = useState<string | null>(null)
  // Kept as the raw rupees string the admin is typing, not paise — toPaise
  // only happens at submit, toRupees only at load.
  const [bankOpeningRupees, setBankOpeningRupees] = useState('0')
  // toLang() on the way in as well as out: default_lang is a plain `text`
  // column to TypeScript (the check constraint lives in the DB).
  const [defaultLang, setDefaultLang] = useState<Lang>('en')
  const [uploading, setUploading] = useState<MandalAssetKind | null>(null)
  const [saving, setSaving] = useState(false)
  // The design's save bar has three states, and they are exactly these two
  // flags: nothing touched, something touched, just saved.
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({ identity: true })

  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }))

  // Every editable control funnels through this, so the save bar can never claim
  // "everything is saved" while an edit is pending.
  function touched() {
    setDirty(true)
    setSaved(false)
  }

  useEffect(() => {
    let active = true

    function applyConfig(config: Mandal) {
      setMandalId(config.id)
      setName(config.name)
      setCityVal(config.city ?? '')
      setStateVal(config.state ?? '')
      setAddress(config.address ?? '')
      // v4 §3: phones live as E.164 now — normalize legacy 10-digit rows on
      // read so PhoneInput seeds from a clean value and a plain re-save keeps it E.164.
      setCreatorPhone(normalizeToE164(config.creator_phone ?? ''))
      setPresidentName(config.president_name ?? '')
      setVisibility(toVisibility(config.transparency_visibility))
      setContacts(
        parseInquiryContacts(config.inquiry_contacts).map((c) => ({
          ...c,
          phone: normalizeToE164(c.phone),
        })),
      )
      setHidePresident(config.hide_president_contact)
      setReceiptPrefix(config.receipt_prefix)
      setUpiVpa(config.upi_vpa ?? '')
      setLogoUrl(config.logo_url)
      setSignatureUrl(config.signature_url)
      setUpiQrUrl(config.upi_qr_url)
      setBankOpeningRupees(String(toRupees(config.bank_opening_paise)))
      setDefaultLang(toLang(config.default_lang))
    }

    getMandal()
      .then((config) => {
        if (active) applyConfig(config)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  async function handleFileChange(kind: MandalAssetKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // allow re-selecting the same file again later
    if (!file) return
    if (!mandalId) return

    setUploading(kind)
    setError(null)
    try {
      const url = await uploadMandalAsset(mandalId, kind, file)
      if (kind === 'logo') setLogoUrl(url)
      if (kind === 'signature') setSignatureUrl(url)
      if (kind === 'upi_qr') setUpiQrUrl(url)
      touched()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(null)
    }
  }

  // F6: up to two extra receipt contacts besides the president.
  function addContact() {
    setContacts((current) => (current.length >= 2 ? current : [...current, { name: '', phone: '' }]))
    touched()
  }

  function updateContact(index: number, patch: Partial<InquiryContact>) {
    setContacts((current) => current.map((c, i) => (i === index ? { ...c, ...patch } : c)))
    touched()
  }

  function removeContact(index: number) {
    setContacts((current) => current.filter((_, i) => i !== index))
    touched()
  }

  // A receipt contact renders as "<name> — <phone>", so both parts are
  // required: drop any row missing either, so a nameless "— 99999" line or a
  // silently-discarded phoneless contact can never reach a donor's receipt.
  const cleanContacts = contacts.filter((c) => c.name.trim() && c.phone.trim())

  // F3: the exact receipt a donor gets, from the CURRENT (unsaved) form values.
  const sampleReceipt: PublicReceipt = {
    amount_paise: 50100,
    mode: 'cash',
    receipt_no: 12,
    receipt_prefix: receiptPrefix,
    created_at: '2026-09-06T12:42:00.000Z',
    donor_name: t.previewSampleDonor,
    mandal_name: name,
    city: cityVal.trim() || null,
    president_name: presidentName.trim() || null,
    // Mirror the SERVER's hide rule (20260719130000: get_public_receipt nulls
    // creator_phone when the president is hidden AND another contact exists).
    // The preview is sold as "the exact receipt a donor gets", so without this
    // an admin who ticks "hide my number" still sees his own mobile printed —
    // the one screen built to verify a privacy setting was lying about it.
    creator_phone: hidePresident && cleanContacts.length > 0 ? null : creatorPhone.trim() || null,
    logo_url: logoUrl,
    signature_url: signatureUrl,
    inquiry_contacts: cleanContacts,
    hide_president_contact: hidePresident,
    voided: false,
    void_reason: null,
  }

  async function handleSave() {
    if (!mandalId) return
    setSaving(true)
    setSaved(false)
    setError(null)

    try {
      await updateMandal(mandalId, {
        name,
        city: cityVal.trim() || null,
        state: stateVal || null,
        address: address.trim() || null,
        creator_phone: creatorPhone.trim() || null,
        president_name: presidentName.trim() || null,
        transparency_visibility: visibility,
        inquiry_contacts: cleanContacts,
        hide_president_contact: hidePresident,
        upi_vpa: upiVpa || null,
        logo_url: logoUrl,
        signature_url: signatureUrl,
        upi_qr_url: upiQrUrl,
        bank_opening_paise: toPaise(Number(bankOpeningRupees) || 0),
        default_lang: defaultLang,
      })
      setDirty(false)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-stone-400">{strings.auth.loading}</p>
  }

  const extraContactSummary =
    cleanContacts.length === 0 ? t.summaryPresidentOnly : t.summaryExtraContacts(cleanContacts.length)

  return (
    <>
      <div className="flex items-start gap-2.5">
        <p className="flex-1 text-[12.5px] leading-relaxed font-medium text-stone-500 text-pretty">
          {t.consoleSubtitle}
        </p>
        <button
          type="button"
          onClick={() => setHowToOpen(true)}
          aria-label={strings.admin.howToEyebrow}
          className={infoRound}
        >
          i
        </button>
      </div>

      <Accordion
        title={t.sectionIdentity}
        summary={[name, cityVal].filter(Boolean).join(' · ')}
        open={!!open.identity}
        onToggle={() => toggle('identity')}
      >
        <p className="text-[11.5px] leading-relaxed font-medium text-stone-400 text-pretty">{t.sectionIdentityHelp}</p>
        <Field label={t.nameLabel}>
          <input
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              touched()
            }}
            className={consoleField}
          />
        </Field>
        <div className="mt-3">
          <CityTypeahead
            city={cityVal}
            state={stateVal}
            onChange={({ city, state }) => {
              setCityVal(city)
              setStateVal(state)
              touched()
            }}
            label={t.cityLabel}
            placeholder={t.cityPlaceholder}
            help={t.cityHelp}
            useAsTypedLabel={t.cityUseAsTyped}
            stateLabel={t.stateLabel}
            statePlaceholder={t.statePlaceholder}
          />
        </div>
        <Field label={t.addressLabel} help={t.addressHelp}>
          <textarea
            rows={2}
            value={address}
            onChange={(e) => {
              setAddress(e.target.value)
              touched()
            }}
            className={`${consoleField} h-[74px] resize-none py-2.5`}
          />
        </Field>
        {/* v4 §3: E.164 via PhoneInput (its own label + help below, so it's not
            wrapped in <Field> — that would double the label). */}
        <div className="mt-3 flex flex-col gap-1.5">
          <PhoneInput
            value={creatorPhone}
            onChange={(v) => {
              setCreatorPhone(v)
              touched()
            }}
            label={t.creatorPhoneLabel}
          />
          <span className="text-[11px] leading-relaxed font-medium text-stone-400">{t.creatorPhoneHelp}</span>
        </div>
      </Accordion>

      <Accordion
        title={t.sectionBranding}
        summary={presidentName.trim() || t.previewNoPresidentName}
        open={!!open.branding}
        onToggle={() => toggle('branding')}
      >
        <p className="text-[11.5px] leading-relaxed font-medium text-stone-400 text-pretty">{t.sectionBrandingShort}</p>
        <ImageField
          id="mandal-logo"
          label={t.logoLabel}
          help={t.logoHint}
          url={logoUrl}
          isUploading={uploading === 'logo'}
          onSelect={(e) => handleFileChange('logo', e)}
        />
        <ImageField
          id="mandal-signature"
          label={t.signatureLabel}
          help={t.signatureHint}
          url={signatureUrl}
          isUploading={uploading === 'signature'}
          onSelect={(e) => handleFileChange('signature', e)}
        />
        <Field label={t.presidentNameLabel} help={t.presidentNameHelp}>
          <input
            value={presidentName}
            onChange={(e) => {
              setPresidentName(e.target.value)
              touched()
            }}
            placeholder={t.presidentNamePlaceholder}
            className={consoleField}
          />
        </Field>
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="mt-3.5 h-11 w-full rounded-xl border border-dashed border-stone-300 bg-stone-50 text-[12.5px] font-bold text-stone-700 transition-colors hover:border-stone-900"
        >
          {t.previewReceiptButton}
        </button>
      </Accordion>

      <Accordion
        title={t.sectionOnlinePayments}
        summary={upiVpa.trim() || t.summaryNoUpi}
        open={!!open.payments}
        onToggle={() => toggle('payments')}
      >
        <p className="text-[11.5px] leading-relaxed font-medium text-stone-400 text-pretty">
          {t.sectionOnlinePaymentsHelp}
        </p>
        <Field label={t.upiVpaLabel}>
          <input
            value={upiVpa}
            onChange={(e) => {
              setUpiVpa(e.target.value)
              touched()
            }}
            placeholder={t.upiVpaPlaceholder}
            className={consoleField}
          />
        </Field>
        <ImageField
          id="mandal-upi-qr"
          label={t.upiQrLabel}
          help={t.upiQrHint}
          url={upiQrUrl}
          isUploading={uploading === 'upi_qr'}
          onSelect={(e) => handleFileChange('upi_qr', e)}
        />
      </Accordion>

      <Accordion
        title={t.sectionVisibility}
        summary={strings.transparencyVisibility[visibility]}
        open={!!open.visibility}
        onToggle={() => toggle('visibility')}
      >
        <p className="text-[11.5px] leading-relaxed font-medium text-stone-400 text-pretty">
          {t.sectionVisibilityHelp}
        </p>
        <fieldset className="mt-3 flex flex-col gap-2">
          <legend className="sr-only">{t.visibilityLabel}</legend>
          {VISIBILITIES.map((v) => (
            <label
              key={v}
              className={`flex cursor-pointer items-start gap-2.5 rounded-[13px] border-[1.5px] px-3 py-2.5 ${
                visibility === v ? 'border-orange-600 bg-orange-50' : 'border-stone-200 bg-white'
              }`}
            >
              <input
                type="radio"
                name="transparency_visibility"
                value={v}
                checked={visibility === v}
                onChange={() => {
                  setVisibility(v)
                  touched()
                }}
                className="mt-0.5 accent-orange-600"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-stone-900">{strings.transparencyVisibility[v]}</span>
                <span className="mt-px block text-[11px] leading-relaxed font-medium text-stone-400">
                  {strings.transparencyVisibility[`${v}Help`]}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </Accordion>

      <Accordion
        title={t.sectionReceipts}
        summary={`${strings.languages[defaultLang]} · ${extraContactSummary}`}
        open={!!open.receipts}
        onToggle={() => toggle('receipts')}
      >
        <p className={`${eyebrow} mb-2`}>{t.defaultLangLabel}</p>
        <div role="group" aria-label={t.defaultLangLabel} className="flex flex-wrap gap-[7px]">
          {LANGS.map((lang) => (
            <button
              key={lang}
              type="button"
              aria-pressed={defaultLang === lang}
              onClick={() => {
                setDefaultLang(lang)
                touched()
              }}
              className={pill(defaultLang === lang)}
            >
              {strings.languages[lang]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed font-medium text-stone-400 text-pretty">{t.defaultLangHelp}</p>

        <p className={`${eyebrow} mt-[18px] mb-2`}>{t.whoDonorsCanCall}</p>
        <div className="rounded-xl border border-hairline bg-stone-50 px-3 py-2.5">
          <p className="text-[9.5px] font-bold tracking-[0.1em] text-stone-400 uppercase">{t.presidentContactTag}</p>
          {/* No mandal-name fallback: v4 §4 removed exactly that from the
              receipt (a mandal is not a person), so showing it here would tell
              the admin his mandal's name appears as the contact when the real
              receipt renders the generic "For inquiries" label. */}
          <p className="mt-0.5 text-[13px] font-semibold text-stone-800">
            {presidentName.trim() || t.previewNoPresidentName}
            {creatorPhone.trim() ? ` · ${formatForDisplay(normalizeToE164(creatorPhone))}` : ''}
          </p>
        </div>

        {contacts.map((contact, i) => (
          <div key={i} className="mt-2.5 flex gap-2">
            <div className="min-w-0 flex-1">
              <input
                aria-label={`${t.contactNameLabel} ${i + 1}`}
                value={contact.name}
                onChange={(e) => updateContact(i, { name: e.target.value })}
                placeholder={t.contactNamePlaceholder}
                className={consoleField}
              />
              <div className="mt-1.5">
                <PhoneInput
                  id={`contact-phone-${i}`}
                  label={`${t.contactPhoneLabel} ${i + 1}`}
                  value={contact.phone}
                  onChange={(e164) => updateContact(i, { phone: e164 })}
                  placeholder={t.contactPhonePlaceholder}
                  hideLabel
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeContact(i)}
              aria-label={`${t.removeContact} ${i + 1}`}
              className="h-[46px] w-[38px] flex-none rounded-[11px] border border-stone-200 bg-white text-sm font-semibold text-stone-400 transition-colors hover:border-red-200 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        ))}

        {contacts.length < 2 && (
          <button
            type="button"
            onClick={addContact}
            className="mt-2.5 h-10 w-full rounded-xl border border-dashed border-stone-300 bg-stone-50 text-[12.5px] font-bold text-stone-600 transition-colors hover:border-stone-900"
          >
            {t.addContactButton}
          </button>
        )}
        <p className="mt-2 text-[11px] font-medium text-stone-400">{t.contactsMaxHint}</p>

        {/* The help sits OUTSIDE the <label> so it doesn't become part of the
            checkbox's accessible name — otherwise a screen reader (and
            getByLabelText) hears the whole explanation as the control's name. */}
        <div className="mt-3.5 rounded-xl border border-hairline bg-stone-50 p-3">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={hidePresident}
              onChange={(e) => {
                setHidePresident(e.target.checked)
                touched()
              }}
              className="mt-0.5 accent-orange-600"
            />
            <span className="flex-1 text-[12.5px] font-bold text-stone-800">{t.hidePresidentLabel}</span>
          </label>
          <p className="mt-1 ml-6 text-[11px] leading-relaxed font-medium text-stone-400 text-pretty">
            {t.hidePresidentHelp}
          </p>
        </div>
      </Accordion>

      {/* Not in the design, but the reconciliation identity needs it: bank
          opening is the one term booksBalanceCheck cannot derive from the
          ledger, so dropping the field would leave a mandal that started with
          money in the bank permanently unable to balance. */}
      <Accordion
        title={t.sectionBooks}
        summary={t.summaryBooks(formatINR(toPaise(Number(bankOpeningRupees) || 0)))}
        open={!!open.books}
        onToggle={() => toggle('books')}
      >
        <Field label={t.bankOpeningLabel} help={formatINR(toPaise(Number(bankOpeningRupees) || 0))}>
          <input
            type="number"
            step="0.01"
            min="0"
            value={bankOpeningRupees}
            onChange={(e) => {
              setBankOpeningRupees(e.target.value)
              touched()
            }}
            className={consoleField}
          />
        </Field>
      </Accordion>

      {/* The design's save bar: it says which of the three states you are in, so
          leaving the screen mid-edit is a decision rather than an accident. */}
      <div className="sticky bottom-0 -mx-4 flex items-center gap-2.5 border-t border-stone-200 bg-stone-50/95 px-4 py-3 backdrop-blur-[10px]">
        <p
          className={`min-w-0 flex-1 text-[11.5px] font-semibold ${
            dirty ? 'text-amber-700' : saved ? 'text-green-800' : 'text-stone-400'
          }`}
        >
          {dirty ? t.saveNoteDirty : saved ? t.saveNoteSaved : t.saveNoteClean}
        </p>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className={`h-11 w-auto flex-none px-5 text-[13.5px] ${dirty ? ctaOrange : ctaMuted}`}
        >
          {saving ? t.saving : t.saveButton}
        </button>
      </div>

      {saved && <p role="status" className="sr-only">{t.saved}</p>}
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {previewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.previewReceiptButton}
          className="fixed inset-0 z-50 overflow-auto bg-black/50"
        >
          <div className="sticky top-0 z-10 flex justify-end p-3">
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="rounded-lg bg-white/95 px-4 py-2 text-sm font-bold text-stone-800 shadow-lg hover:bg-white"
            >
              {t.closePreview}
            </button>
          </div>
          <ReceiptView receipt={sampleReceipt} lang={defaultLang} />
        </div>
      )}

      <HowToSheet tab="settings" open={howToOpen} onClose={() => setHowToOpen(false)} />
    </>
  )
}
