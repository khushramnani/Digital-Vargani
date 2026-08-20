import { LANGS, type Lang } from '../../lib/i18n/receipt'
import { strings } from '../../lib/strings'
import { eyebrow, pill } from '../../components/ui'

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
    <fieldset className="flex flex-col gap-2">
      <legend className={eyebrow}>{label}</legend>
      <div className="flex flex-wrap gap-[7px]">
        {LANGS.map((code) => (
          <label
            key={code}
            className={`${pill(lang === code)} flex cursor-pointer items-center justify-center`}
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
