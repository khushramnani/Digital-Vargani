import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  getMandal,
  updateMandal,
  uploadMandalAsset,
  type MandalAssetKind,
  type Mandal,
} from '../../lib/db/config'
import { INDIAN_STATES } from '../../lib/states'
import { LANGS, toLang, type Lang } from '../../lib/i18n/receipt'
import { toPaise, toRupees, formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'

const t = strings.mandalConfig

const inputCls =
  'w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-[15px] text-stone-900 outline-none placeholder:text-stone-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20'

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

// Admin-only screen (routed behind RequireRole role="admin"). Single form
// over the admin's own mandals row + its Storage-backed assets — RLS scopes
// the row, so there's no tenant filter here. No volunteer management on this
// screen, that's settings/volunteers.tsx.
export function MandalConfigScreen() {
  const [loading, setLoading] = useState(true)
  // Held in state because updateMandal and uploadMandalAsset both need it.
  const [mandalId, setMandalId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [stateVal, setStateVal] = useState('')
  const [address, setAddress] = useState('')
  const [creatorPhone, setCreatorPhone] = useState('')
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
      setStateVal(config.state ?? '')
      setAddress(config.address ?? '')
      setCreatorPhone(config.creator_phone ?? '')
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mandalId) return
    setSaving(true)
    setSaved(false)
    setError(null)

    try {
      await updateMandal(mandalId, {
        name,
        state: stateVal || null,
        address: address.trim() || null,
        creator_phone: creatorPhone.trim() || null,
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
    return <p className="mx-auto max-w-2xl px-4 py-8 text-stone-400">{strings.auth.loading}</p>
  }

  return (
    <div className="min-h-screen bg-stone-50 font-body">
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
        <div>
          <Link to="/admin" className="text-sm font-semibold text-orange-600 hover:text-orange-700">
            {t.backLink}
          </Link>
          <h1 className="font-display mt-2 text-2xl font-extrabold tracking-tight text-stone-900">{t.title}</h1>
          <p className="mt-1 text-[15px] text-stone-500">{t.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Section title={t.sectionIdentity} help={t.sectionIdentityHelp}>
            <Field label={t.nameLabel}>
              <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </Field>
            <Field label={t.stateLabel}>
              <select
                value={stateVal}
                onChange={(e) => setStateVal(e.target.value)}
                className={`${inputCls} ${stateVal ? '' : 'text-stone-400'}`}
              >
                <option value="">{t.statePlaceholder}</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s} className="text-stone-900">
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.addressLabel} help={t.addressHelp}>
              <textarea
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={`${inputCls} resize-none`}
              />
            </Field>
            <Field label={t.creatorPhoneLabel} help={t.creatorPhoneHelp}>
              <input
                type="tel"
                inputMode="tel"
                value={creatorPhone}
                onChange={(e) => setCreatorPhone(e.target.value)}
                className={inputCls}
              />
            </Field>
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
        </form>
      </main>
    </div>
  )
}
