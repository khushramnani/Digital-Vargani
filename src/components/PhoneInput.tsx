import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { COUNTRIES, DEFAULT_COUNTRY_ISO, type Country } from '../lib/countries'
import { parseE164, toE164 } from '../lib/phone'
import { strings } from '../lib/strings'
import { field } from './ui'

// v4: a Google-style phone field — a searchable country picker (flag + dial
// code) chipped to the LEFT of a national-number input, so the +<dialCode>
// being assumed is always on screen (kills the old silent +91). Emits an
// E.164 string (toE164) on every change; seeds itself from a stored E.164
// value (parseE164). Combobox/listbox a11y mirrors CityTypeahead.

const DEFAULT_COUNTRY = COUNTRIES.find((c) => c.iso === DEFAULT_COUNTRY_ISO)!

export function PhoneInput({
  value,
  onChange,
  label,
  id,
  required,
  placeholder,
}: {
  value: string // E.164, e.g. '+919876543210'
  onChange: (e164: string) => void
  label: string
  id?: string
  required?: boolean
  placeholder?: string
}) {
  const generated = useId()
  const inputId = id ?? generated
  const listId = `${inputId}-country-list`

  // National number is DERIVED from value (controlled) — value always begins
  // with the selected country's code (we build it), so stripping it back off is
  // exact. No local mirror to keep in sync.
  const national = value ? parseE164(value).national : ''

  const [country, setCountry] = useState<Country>(() =>
    value ? COUNTRIES.find((c) => c.iso === parseE164(value).iso) ?? DEFAULT_COUNTRY : DEFAULT_COUNTRY,
  )
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const numberRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Re-seed the country when the parent pushes a value carrying a DIFFERENT
  // country code (initial load, or a stored-value swap) — React's "adjust state
  // during render" pattern, no effect. Guarding on dialCode difference means a
  // country picked while the national is empty (emits '') never snaps back, and
  // a shared-code pick (GG vs GB) the user made is preserved.
  const [seenValue, setSeenValue] = useState(value)
  if (value !== seenValue) {
    setSeenValue(value)
    if (value) {
      const p = parseE164(value)
      if (p.dialCode !== country.dialCode) {
        setCountry(COUNTRIES.find((c) => c.iso === p.iso) ?? DEFAULT_COUNTRY)
      }
    }
  }

  function selectCountry(c: Country) {
    setCountry(c)
    setOpen(false)
    setQuery('')
    onChange(toE164(c.dialCode, national))
    numberRef.current?.focus()
  }

  function onNationalChange(raw: string) {
    onChange(toE164(country.dialCode, raw.replace(/\D/g, '')))
  }

  const q = query.trim().toLowerCase().replace(/^\+/, '')
  const filtered = q
    ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.dialCode.includes(q))
    : [DEFAULT_COUNTRY, ...COUNTRIES.filter((c) => c.iso !== DEFAULT_COUNTRY_ISO)]
  const activeIdx = Math.min(active, Math.max(0, filtered.length - 1))

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, filtered.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
      return
    }
    if (e.key === 'Enter' && filtered[activeIdx]) {
      e.preventDefault()
      selectCountry(filtered[activeIdx])
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-stone-700">
        {label}
        {required && <span className="text-orange-600"> *</span>}
      </label>
      <div className="flex gap-2">
        {/* Country selector — the +<dialCode> chip is always visible */}
        <div className="relative">
          <button
            ref={buttonRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o)
              setQuery('')
              setActive(0)
            }}
            className="flex h-full items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 text-[15px] text-stone-900 transition-colors hover:bg-stone-50 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
          >
            <span className="text-lg leading-none">{country.flag}</span>
            <span className="font-semibold">+{country.dialCode}</span>
            <span aria-hidden className="text-stone-400">
              ▾
            </span>
          </button>
          {open && (
            <div className="absolute z-30 mt-1 w-72 rounded-xl border border-stone-200 bg-white shadow-lg">
              <div className="p-2">
                <input
                  autoFocus
                  role="combobox"
                  aria-expanded
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={filtered[activeIdx] ? `${listId}-${activeIdx}` : undefined}
                  autoComplete="off"
                  value={query}
                  placeholder={strings.app.countrySearchPlaceholder}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setActive(0)
                  }}
                  onKeyDown={onSearchKeyDown}
                  // Closing on blur mirrors CityTypeahead; options preventDefault
                  // their mousedown so the click lands before this fires.
                  onBlur={() => setOpen(false)}
                  className={field}
                />
              </div>
              <ul id={listId} role="listbox" className="max-h-64 overflow-auto pb-1">
                {filtered.map((c, i) => (
                  <li
                    key={c.iso}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === activeIdx}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectCountry(c)}
                    className={`flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[15px] text-stone-700 ${
                      i === activeIdx ? 'bg-orange-50' : ''
                    }`}
                  >
                    <span className="text-lg leading-none">{c.flag}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-stone-400">+{c.dialCode}</span>
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-3.5 py-2 text-[15px] text-stone-400">—</li>
                )}
              </ul>
            </div>
          )}
        </div>

        <input
          ref={numberRef}
          id={inputId}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          required={required}
          value={national}
          placeholder={placeholder}
          onChange={(e) => onNationalChange(e.target.value)}
          className={`${field} flex-1`}
        />
      </div>
    </div>
  )
}
