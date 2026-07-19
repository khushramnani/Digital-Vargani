import { useId, useState, type KeyboardEvent } from 'react'
import { INDIAN_CITIES } from '../lib/cities'
import { field as inputCls } from './ui'

// F7: a bundled, offline city typeahead that fills BOTH city and state from one
// pick (the bundled list carries the canonical state for each city). Free-text
// fallback ("Use as typed") keeps a village that never makes the list unblocked.
// No external deps — a controlled input + a filtered <ul role="listbox">.

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
  id,
}: {
  city: string
  state: string
  onChange: (v: Value) => void
  label: string
  placeholder?: string
  help?: string
  useAsTypedLabel: string
  id?: string
}) {
  const generated = useId()
  const inputId = id ?? generated
  const listId = `${inputId}-list`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const query = city.trim().toLowerCase()
  const matches = query
    ? INDIAN_CITIES.filter((c) => c.city.toLowerCase().startsWith(query)).slice(0, MAX)
    : []
  // Offer the free-text option whenever the typed value isn't already an exact
  // city name — that covers "matches nothing" and forcing a custom spelling.
  const hasExact = query.length > 0 && INDIAN_CITIES.some((c) => c.city.toLowerCase() === query)
  const showTyped = query.length > 0 && !hasExact
  const optionCount = matches.length + (showTyped ? 1 : 0)
  const showList = open && optionCount > 0
  const activeIdx = Math.min(active, Math.max(0, optionCount - 1))

  function pick(i: number) {
    if (i < matches.length) {
      const c = matches[i]
      onChange({ city: c.city, state: c.state })
    } else {
      // "Use as typed": keep whatever state is currently set. Editing the city
      // text already cleared a stale picked-state (see the input onChange), so
      // here `state` is either '' (they retyped a new city) or a legitimate
      // legacy value the admin is simply confirming — which must NOT be wiped
      // (the settings form has no separate state field to re-enter it).
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
    <div className="flex flex-col gap-1.5">
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
            // Typing over the city invalidates any auto-filled state (it
            // belonged to the previously-picked city). A real re-pick sets both
            // again; an untouched legacy city+state is preserved because no
            // keystroke fires. This is what makes "Use as typed" safe to keep
            // the current state.
            onChange({ city: e.target.value, state: '' })
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
  )
}
