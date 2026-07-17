import { LANGS, type Lang } from '../../lib/i18n/receipt'
import { strings } from '../../lib/strings'

// A segmented radio group, not a <select> — one tap to change on a phone, and
// it announces to a screen reader. Shared by the collection form and the
// pending-send tray so the two pickers can't drift, the same reason
// strings.languages lives in one place. Preset logic is in useReceiptLang.
export function LanguagePicker({
  lang,
  onChange,
  label,
}: {
  lang: Lang
  onChange: (lang: Lang) => void
  label: string
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm text-stone-600">{label}</legend>
      <div className="flex gap-1">
        {LANGS.map((code) => (
          <label
            key={code}
            className={`flex-1 cursor-pointer rounded border px-2 py-2 text-center text-sm ${
              lang === code ? 'border-orange-700 bg-orange-50 text-orange-900' : 'border-stone-300 text-stone-600'
            }`}
          >
            <input
              type="radio"
              name="receipt-lang"
              value={code}
              checked={lang === code}
              onChange={() => onChange(code)}
              className="sr-only"
            />
            {strings.languages[code]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
