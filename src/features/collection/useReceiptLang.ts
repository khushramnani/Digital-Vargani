import { useEffect, useState } from 'react'
import { getMandalDefaultLang } from '../../lib/db/config'
import { type Lang } from '../../lib/i18n/receipt'

// The language a receipt is sent in, preset from the mandal default and
// re-pickable. Both the collection form and the pending-send tray use this —
// each owns its own state, but the preset logic lives in one place.
//
// Preset, not a prompt: SPEC.md criterion 1 gives the volunteer ≤3 taps to
// the SMS composer, so the common case (the mandal's own language) must cost
// zero of them. getMandalDefaultLang never throws — worst case this stays
// 'en'. The `active` guard covers the component unmounting before the fetch
// resolves.
export function useReceiptLang(): [Lang, (lang: Lang) => void] {
  const [lang, setLang] = useState<Lang>('en')
  useEffect(() => {
    let active = true
    getMandalDefaultLang().then((l) => {
      if (active) setLang(l)
    })
    return () => {
      active = false
    }
  }, [])
  return [lang, setLang]
}
