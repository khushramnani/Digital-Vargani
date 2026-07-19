import { useId, useState, type KeyboardEvent } from 'react'
import { INDIAN_CITIES } from '../lib/cities'
import { INDIAN_STATES } from '../lib/states'
import { field as inputCls } from './ui'

// F7 (v4): city + state as TWO visible, user-owned fields sharing one offline
// assist layer (bundled INDIAN_CITIES/STATES, zero API).
//  - City combobox: typing suggests "Vadodara, Gujarat"; picking one fills BOTH
//    fields — and a pick whose state disagrees with the chosen one overwrites
//    it (pick wins, a visible change).
//  - State field: a native <datalist> over the 36 states/UTs (free-type filter).
//    A chosen state pulls its own cities to the top of the city suggestions.
//  - Neither field ever blocks free text — the dataset only suggests. A city
//    that isn't in the list is kept as typed ("Use as typed").
// The old "wipe state on a city keystroke" behavior is gone: state is now its
// own editable field, so typing a city preserves whatever state is shown.
// Export name kept (`CityTypeahead`) so both consumers import it unchanged.

const MAX = 8

type Value = { city: string; state: string }

export function CityTypeahead({
  city,
  state,
  onChange,
  label,
  placeholder,
  help,
  useAsTypedLabel,
  stateLabel,
  statePlaceholder,
  id,
}: {
  city: string
  state: string
  onChange: (v: Value) => void
  label: string
  placeholder?: string
  help?: string
  useAsTypedLabel: string
  stateLabel: string
  statePlaceholder?: string
  id?: string
}) {
  const generated = useId()
  const inputId = id ?? generated
  const listId = `${inputId}-list`
  const stateId = `${inputId}-state`
  const stateListId = `${inputId}-states`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const query = city.trim().toLowerCase()
  const stateSel = state.trim().toLowerCase()
  const starts = query
    ? INDIAN_CITIES.filter((c) => c.city.toLowerCase().startsWith(query))
    : []
  // A chosen state pulls its own cities to the top (the rest still follow, so
  // a mismatched free-type is never hidden — the pick can still correct state).
  const ranked = stateSel
    ? [
        ...starts.filter((c) => c.state.toLowerCase() === stateSel),
        ...starts.filter((c) => c.state.toLowerCase() !== stateSel),
      ]
    : starts
  const matches = ranked.slice(0, MAX)
  // Offer the free-text option whenever the typed value isn't already an exact
  // city name — that covers "matches nothing" and forcing a custom spelling.
  const hasExact = query.length > 0 && INDIAN_CITIES.some((c) => c.city.toLowerCase() === query)
  const showTyped = query.length > 0 && !hasExact
  const optionCount = matches.length + (showTyped ? 1 : 0)
  const showList = open && optionCount > 0
  const activeIdx = Math.min(active, Math.max(0, optionCount - 1))

  function pick(i: number) {
    if (i < matches.length) {
      // Pick wins: fills city AND state, overwriting a disagreeing state.
      const c = matches[i]
      onChange({ city: c.city, state: c.state })
    } else {
      // "Use as typed": keep the state the user already sees in its own field.
      onChange({ city: city.trim(), state })
    }
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, optionCount - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
      return
    }
    if (e.key === 'Enter' && showList) {
      e.preventDefault()
      pick(activeIdx)
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {/* City combobox — a pick fills both fields */}
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-semibold text-stone-700">
          {label}
        </label>
        <div className="relative">
          <input
            id={inputId}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList ? `${listId}-${activeIdx}` : undefined}
            autoComplete="off"
            value={city}
            placeholder={placeholder}
            onChange={(e) => {
              // State is its own field now — a city keystroke leaves it alone.
              onChange({ city: e.target.value, state })
              setOpen(true)
              setActive(0)
            }}
            onFocus={() => setOpen(true)}
            // Options use onMouseDown+preventDefault so this blur doesn't fire
            // before their click registers.
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            className={inputCls}
          />
          {showList && (
            <ul
              id={listId}
              role="listbox"
              className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lg"
            >
              {matches.map((c, i) => (
                <li
                  key={`${c.city}|${c.state}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(i)}
                  className={`cursor-pointer px-3.5 py-2 text-[15px] text-stone-700 ${i === activeIdx ? 'bg-orange-50' : ''}`}
                >
                  {c.city}, {c.state}
                </li>
              ))}
              {showTyped && (
                <li
                  id={`${listId}-${matches.length}`}
                  role="option"
                  aria-selected={activeIdx === matches.length}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(matches.length)}
                  className={`cursor-pointer border-t border-stone-100 px-3.5 py-2 text-[15px] ${
                    activeIdx === matches.length ? 'bg-orange-50' : ''
                  }`}
                >
                  <span className="font-semibold text-orange-600">{useAsTypedLabel}</span>{' '}
                  <span className="text-stone-500">“{city.trim()}”</span>
                </li>
              )}
            </ul>
          )}
        </div>
        {help && <span className="text-xs leading-relaxed text-stone-500">{help}</span>}
      </div>

      {/* State field — native <datalist>: the 36 states/UTs, free-type filter.
          ponytail: no hard "must be one of 36" block; the list steers, a pick
          gives the canonical name. Tighten to on-blur validation only if a
          stray state ever actually reaches the DB. */}
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor={stateId} className="text-sm font-semibold text-stone-700">
          {stateLabel}
        </label>
        <input
          id={stateId}
          list={stateListId}
          autoComplete="off"
          value={state}
          placeholder={statePlaceholder}
          onChange={(e) => onChange({ city, state: e.target.value })}
          className={inputCls}
        />
        <datalist id={stateListId}>
          {INDIAN_STATES.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
    </div>
  )
}
