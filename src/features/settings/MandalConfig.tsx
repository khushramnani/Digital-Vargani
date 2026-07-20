import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
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
import { field as inputCls } from '../../components/ui'
import { ReceiptView } from '../receipt/ReceiptPage'
import { parseInquiryContacts, type InquiryContact, type PublicReceipt } from '../../lib/db/receipt'

// F5: the four transparency-report audiences, shared with strings.transparencyVisibility.
const VISIBILITIES = ['public', 'members', 'admins', 'disabled'] as const
type Visibility = (typeof VISIBILITIES)[number]
const toVisibility = (v: string): Visibility =>
  (VISIBILITIES as readonly string[]).includes(v) ? (v as Visibility) : 'public'

const t = strings.mandalConfig

function Section({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4">
        <h2 className="font-display text-base font-bold tracking-tight text-stone-900">{title}</h2>
        {help && <p className="mt-0.5 text-[13px] text-stone-500">{help}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  // help lives OUTSIDE the <label> so it doesn't become part of the control's
  // accessible name (getByLabelText would otherwise see "Bank opening (₹)₹0").
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-stone-700">{label}</span>
        {children}
      </label>
      {help && <span className="text-xs leading-relaxed text-stone-500">{help}</span>}
    </div>
  )
}

function ImageField({
  id,
  label,
  url,
  isUploading,
  onSelect,
}: {
  id: string
  label: string
  url: string | null
  isUploading: boolean
  onSelect: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* htmlFor keeps the field name the input's accessible label (the
          styled button below is a second, wrapping label showing Change /
          Upload). */}
      <label htmlFor={id} className="text-sm font-semibold text-stone-700">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
          {url ? (
            <img src={url} alt={label} className="h-full w-full object-contain" />
          ) : (
            <span className="text-lg text-stone-300">＋</span>
          )}
        </div>
        <label className="cursor-pointer rounded-lg border border-stone-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">
          {url ? t.changeImage : t.uploadImage}
          <input id={id} type="file" accept="image/*" className="sr-only" onChange={onSelect} />
        </label>
        {isUploading && <span className="text-sm text-stone-400">{t.uploading}</span>}
      </div>
    </div>
  )
}

// Admin-only content body (rendered inside AdminLayout's console frame at
// /admin/settings). Single form over the admin's own mandals row + its
// Storage-backed assets — RLS scopes the row, so there's no tenant filter here.
// No member management on this screen, that's settings/members.tsx.
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
  // Not editable here, but the receipt preview + numbering need it.
  const [receiptPrefix, setReceiptPrefix] = useState('VM')
  const [upiVpa, setUpiVpa] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [upiQrUrl, setUpiQrUrl] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [newCategory, setNewCategory] = useState('')
  // Kept as the raw rupees string the admin is typing, not paise — toPaise
  // only happens at submit, toRupees only at load.
  const [bankOpeningRupees, setBankOpeningRupees] = useState('0')
  // toLang() on the way in as well as out: default_lang is a plain `text`
  // column to TypeScript (the check constraint lives in the DB).
  const [defaultLang, setDefaultLang] = useState<Lang>('en')
  const [uploading, setUploading] = useState<MandalAssetKind | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      setCategories(config.expense_categories)
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(null)
    }
  }

  function addCategory() {
    const trimmed = newCategory.trim()
    if (!trimmed || categories.includes(trimmed)) return
    setCategories((current) => [...current, trimmed])
    setNewCategory('')
  }

  function removeCategory(category: string) {
    setCategories((current) => current.filter((c) => c !== category))
  }

  // F6: up to two extra receipt contacts besides the president.
  function addContact() {
    setContacts((current) => (current.length >= 2 ? current : [...current, { name: '', phone: '' }]))
  }

  function updateContact(index: number, patch: Partial<InquiryContact>) {
    setContacts((current) => current.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  function removeContact(index: number) {
    setContacts((current) => current.filter((_, i) => i !== index))
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
    creator_phone:
      hidePresident && cleanContacts.length > 0 ? null : creatorPhone.trim() || null,
    logo_url: logoUrl,
    signature_url: signatureUrl,
    inquiry_contacts: cleanContacts,
    hide_president_contact: hidePresident,
    voided: false,
    void_reason: null,
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
        expense_categories: categories,
        bank_opening_paise: toPaise(Number(bankOpeningRupees) || 0),
        default_lang: defaultLang,
      })
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

  return (
    <>
      <p className="text-[15px] text-stone-500">{t.subtitle}</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Section title={t.sectionIdentity} help={t.sectionIdentityHelp}>
            <Field label={t.nameLabel}>
              <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
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
            <Field label={t.addressLabel} help={t.addressHelp}>
              <textarea
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={`${inputCls} resize-none`}
              />
            </Field>
            {/* v4 §3: E.164 via PhoneInput (its own label + help below, so it's
                not wrapped in <Field> — that would double the label). */}
            <div className="flex flex-col gap-1.5">
              <PhoneInput value={creatorPhone} onChange={setCreatorPhone} label={t.creatorPhoneLabel} />
              <span className="text-xs leading-relaxed text-stone-500">{t.creatorPhoneHelp}</span>
            </div>
          </Section>

          <Section title={t.sectionBranding} help={t.sectionBrandingHelp}>
            <ImageField
              id="mandal-logo"
              label={t.logoLabel}
              url={logoUrl}
              isUploading={uploading === 'logo'}
              onSelect={(e) => handleFileChange('logo', e)}
            />
            <ImageField
              id="mandal-signature"
              label={t.signatureLabel}
              url={signatureUrl}
              isUploading={uploading === 'signature'}
              onSelect={(e) => handleFileChange('signature', e)}
            />
            <Field label={t.presidentNameLabel} help={t.presidentNameHelp}>
              <input
                value={presidentName}
                onChange={(e) => setPresidentName(e.target.value)}
                placeholder={t.presidentNamePlaceholder}
                className={inputCls}
              />
            </Field>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="w-fit rounded-lg border border-stone-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
              >
                {t.previewReceiptButton}
              </button>
              <span className="text-xs leading-relaxed text-stone-500">{t.previewReceiptHint}</span>
            </div>
          </Section>

          <Section title={t.sectionPayments} help={t.sectionPaymentsHelp}>
            <Field label={t.upiVpaLabel}>
              <input
                value={upiVpa}
                onChange={(e) => setUpiVpa(e.target.value)}
                placeholder={t.upiVpaPlaceholder}
                className={inputCls}
              />
            </Field>
            <ImageField
              id="mandal-upi-qr"
              label={t.upiQrLabel}
              url={upiQrUrl}
              isUploading={uploading === 'upi_qr'}
              onSelect={(e) => handleFileChange('upi_qr', e)}
            />
          </Section>

          <Section title={t.sectionTransparency} help={t.sectionTransparencyHelp}>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-semibold text-stone-700">{t.visibilityLabel}</legend>
              {VISIBILITIES.map((v) => (
                <div key={v} className="flex flex-col">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="transparency_visibility"
                      value={v}
                      checked={visibility === v}
                      onChange={() => setVisibility(v)}
                      className="accent-orange-600"
                    />
                    <span className="text-sm font-semibold text-stone-800">{strings.transparencyVisibility[v]}</span>
                  </label>
                  <span className="ml-6 text-xs leading-relaxed text-stone-500">
                    {strings.transparencyVisibility[`${v}Help`]}
                  </span>
                </div>
              ))}
            </fieldset>
          </Section>

          <Section title={t.sectionContacts} help={t.sectionContactsHelp}>
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
              <p className="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">{t.presidentContactTag}</p>
              {/* No mandal-name fallback: v4 §4 removed exactly that from the
                  receipt (a mandal is not a person), so showing it here would
                  tell the admin his mandal's name appears as the contact when
                  the real receipt renders the generic "For inquiries" label. */}
              <p className="mt-1 text-sm text-stone-800">
                {presidentName.trim() || t.previewNoPresidentName}
                {creatorPhone.trim() ? ` · ${formatForDisplay(normalizeToE164(creatorPhone))}` : ''}
              </p>
            </div>

            {contacts.map((contact, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-xl border border-stone-200 p-3">
                <div className="flex gap-2">
                  <input
                    aria-label={`${t.contactNameLabel} ${i + 1}`}
                    value={contact.name}
                    onChange={(e) => updateContact(i, { name: e.target.value })}
                    placeholder={t.contactNamePlaceholder}
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => removeContact(i)}
                    aria-label={`${t.removeContact} ${i + 1}`}
                    className="flex-none rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-500 hover:bg-stone-50 hover:text-stone-700"
                  >
                    ×
                  </button>
                </div>
                <PhoneInput
                  id={`contact-phone-${i}`}
                  label={`${t.contactPhoneLabel} ${i + 1}`}
                  value={contact.phone}
                  onChange={(e164) => updateContact(i, { phone: e164 })}
                  placeholder={t.contactPhonePlaceholder}
                />
              </div>
            ))}

            {contacts.length < 2 && (
              <button
                type="button"
                onClick={addContact}
                className="w-fit rounded-lg border border-stone-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
              >
                {t.addContactButton}
              </button>
            )}
            <p className="text-xs leading-relaxed text-stone-500">{t.contactsMaxHint}</p>

            <div className="flex flex-col gap-1.5">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={hidePresident}
                  onChange={(e) => setHidePresident(e.target.checked)}
                  className="mt-0.5 accent-orange-600"
                />
                <span className="text-sm font-semibold text-stone-700">{t.hidePresidentLabel}</span>
              </label>
              <span className="ml-6 text-xs leading-relaxed text-stone-500">{t.hidePresidentHelp}</span>
            </div>
          </Section>

          <Section title={t.sectionBooks}>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-stone-700">{t.categoriesLabel}</span>
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <span
                    key={category}
                    className="flex items-center gap-1.5 rounded-full bg-stone-100 py-1 pr-2 pl-3 text-sm text-stone-700"
                  >
                    {category}
                    <button
                      type="button"
                      onClick={() => removeCategory(category)}
                      aria-label={`${t.removeCategory}: ${category}`}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-stone-400 hover:bg-stone-200 hover:text-stone-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addCategory()
                    }
                  }}
                  placeholder={t.addCategoryPlaceholder}
                  aria-label={t.addCategoryPlaceholder}
                  className={`${inputCls} flex-1`}
                />
                <button
                  type="button"
                  onClick={addCategory}
                  className="flex-none rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700 hover:bg-stone-50"
                >
                  {t.addCategory}
                </button>
              </div>
            </div>

            <Field label={t.bankOpeningLabel} help={formatINR(toPaise(Number(bankOpeningRupees) || 0))}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={bankOpeningRupees}
                onChange={(e) => setBankOpeningRupees(e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label={t.defaultLangLabel} help={t.defaultLangHelp}>
              <select
                value={defaultLang}
                onChange={(e) => setDefaultLang(toLang(e.target.value))}
                className={inputCls}
              >
                {LANGS.map((lang) => (
                  <option key={lang} value={lang}>
                    {strings.languages[lang]}
                  </option>
                ))}
              </select>
            </Field>
          </Section>

          <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-stone-200 bg-stone-50/90 px-4 py-3 backdrop-blur">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-colors hover:bg-stone-900 disabled:opacity-50"
            >
              {saving ? t.saving : t.saveButton}
            </button>
            {saved && <span className="text-sm font-semibold text-green-700">{t.saved}</span>}
            {error && (
              <span role="alert" className="text-sm text-red-600">
                {error}
              </span>
            )}
          </div>

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
      </form>
    </>
  )
}
