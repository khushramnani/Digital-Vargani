import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  getMandalConfig,
  updateMandalConfig,
  uploadMandalAsset,
  type MandalAssetKind,
  type MandalConfig,
} from '../../lib/db/config'
import { toPaise, toRupees, formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'

const t = strings.mandalConfig

// Admin-only screen (routed behind RequireRole role="admin"). Single form
// over the single-row mandal_config table + its three Storage-backed
// assets — no volunteer management here, that's settings/volunteers.tsx.
export function MandalConfigScreen() {
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [upiVpa, setUpiVpa] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [upiQrUrl, setUpiQrUrl] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [newCategory, setNewCategory] = useState('')
  // Kept as the raw rupees string the admin is typing, not paise — the
  // toPaise conversion only happens at submit time (and toRupees only at
  // load time), per the brief: this is the first screen to need it.
  const [bankOpeningRupees, setBankOpeningRupees] = useState('0')
  const [uploading, setUploading] = useState<MandalAssetKind | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    function applyConfig(config: MandalConfig) {
      setName(config.name)
      setUpiVpa(config.upi_vpa ?? '')
      setLogoUrl(config.logo_url)
      setSignatureUrl(config.signature_url)
      setUpiQrUrl(config.upi_qr_url)
      setCategories(config.expense_categories)
      setBankOpeningRupees(String(toRupees(config.bank_opening_paise)))
    }

    getMandalConfig()
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

    setUploading(kind)
    setError(null)
    try {
      const url = await uploadMandalAsset(kind, file)
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
    setSaving(true)
    setSaved(false)
    setError(null)

    try {
      await updateMandalConfig({
        name,
        upi_vpa: upiVpa || null,
        logo_url: logoUrl,
        signature_url: signatureUrl,
        upi_qr_url: upiQrUrl,
        expense_categories: categories,
        bank_opening_paise: toPaise(Number(bankOpeningRupees) || 0),
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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold text-stone-900">{t.title}</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded border border-stone-300 p-4">
        <label htmlFor="mandal-name" className="text-sm text-stone-600">
          {t.nameLabel}
        </label>
        <input
          id="mandal-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />

        <label htmlFor="mandal-logo" className="text-sm text-stone-600">
          {t.logoLabel}
        </label>
        <input id="mandal-logo" type="file" accept="image/*" onChange={(event) => handleFileChange('logo', event)} />
        {logoUrl && <img src={logoUrl} alt={t.logoLabel} className="h-16 w-16 rounded object-contain" />}

        <label htmlFor="mandal-signature" className="text-sm text-stone-600">
          {t.signatureLabel}
        </label>
        <input
          id="mandal-signature"
          type="file"
          accept="image/*"
          onChange={(event) => handleFileChange('signature', event)}
        />
        {signatureUrl && <img src={signatureUrl} alt={t.signatureLabel} className="h-16 w-16 rounded object-contain" />}

        <label htmlFor="mandal-upi-vpa" className="text-sm text-stone-600">
          {t.upiVpaLabel}
        </label>
        <input
          id="mandal-upi-vpa"
          value={upiVpa}
          onChange={(event) => setUpiVpa(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />

        <label htmlFor="mandal-upi-qr" className="text-sm text-stone-600">
          {t.upiQrLabel}
        </label>
        <input
          id="mandal-upi-qr"
          type="file"
          accept="image/*"
          onChange={(event) => handleFileChange('upi_qr', event)}
        />
        {upiQrUrl && <img src={upiQrUrl} alt={t.upiQrLabel} className="h-16 w-16 rounded object-contain" />}

        <span className="text-sm text-stone-600">{t.categoriesLabel}</span>
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <span key={category} className="flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1 text-sm">
              {category}
              <button
                type="button"
                onClick={() => removeCategory(category)}
                aria-label={`${t.removeCategory}: ${category}`}
                className="text-stone-500"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            placeholder={t.addCategoryPlaceholder}
            aria-label={t.addCategoryPlaceholder}
            className="flex-1 rounded border border-stone-300 px-3 py-2"
          />
          <button
            type="button"
            onClick={addCategory}
            className="rounded border border-stone-300 px-3 py-2 text-sm text-stone-700"
          >
            {t.addCategory}
          </button>
        </div>

        <label htmlFor="mandal-bank-opening" className="text-sm text-stone-600">
          {t.bankOpeningLabel}
        </label>
        <input
          id="mandal-bank-opening"
          type="number"
          step="0.01"
          min="0"
          value={bankOpeningRupees}
          onChange={(event) => setBankOpeningRupees(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        <p className="text-sm text-stone-400">{formatINR(toPaise(Number(bankOpeningRupees) || 0))}</p>

        <button
          type="submit"
          disabled={saving}
          className="rounded bg-orange-700 px-3 py-2 text-white disabled:opacity-50"
        >
          {saving ? t.saving : t.saveButton}
        </button>
        {uploading && <p className="text-sm text-stone-400">{t.uploading}</p>}
        {saved && <p className="text-sm text-green-700">{t.saved}</p>}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </form>
    </main>
  )
}
