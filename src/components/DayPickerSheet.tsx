import { useState } from 'react'
import { formatLocalDay, parseLocalDay } from '../lib/dayFilter'
import { strings } from '../lib/strings'
import { Sheet } from './Sheet'
import { SheetHeader } from './console'
import { ctaInk } from './ui'

const t = strings.ledger

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The design's `picker` sheet: a month grid where a dot marks every day that has
// collections, future days are inert, and one button jumps back to today. Shared
// by the Overview day card and the Collections date filter — the design uses the
// same sheet for both, and two copies of a calendar is two calendars to get wrong.
//
// Every date decision goes through parseLocalDay/formatLocalDay (lib/dayFilter),
// so "which day is this" is answered in the device's own timezone rather than by
// slicing a UTC string.
export function DayPickerSheet({
  open,
  onClose,
  selected,
  onPick,
  markedDays,
  today = formatLocalDay(new Date()),
}: {
  open: boolean
  onClose: () => void
  // The currently-chosen day, or '' when the filter has no day set yet.
  selected: string
  onPick: (day: string) => void
  markedDays: Set<string>
  today?: string
}) {
  if (!open) return null
  return (
    <Sheet open onClose={onClose} labelledBy="day-picker-title">
      <PickerBody selected={selected} onPick={onPick} onClose={onClose} markedDays={markedDays} today={today} />
    </Sheet>
  )
}

function PickerBody({
  selected,
  onPick,
  onClose,
  markedDays,
  today,
}: {
  selected: string
  onPick: (day: string) => void
  onClose: () => void
  markedDays: Set<string>
  today: string
}) {
  // Open on the month of whatever is selected, else on today's. Mounted fresh
  // each time the sheet opens (Sheet renders nothing while closed), so this is
  // an initial value, not state to keep in sync.
  const start = parseLocalDay(selected) ?? parseLocalDay(today) ?? new Date()
  const [year, setYear] = useState(start.getFullYear())
  const [month, setMonth] = useState(start.getMonth())

  const key = (day: number) => formatLocalDay(new Date(year, month, day))
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // getDay() is 0-based Sunday; CSS grid columns are 1-based.
  const firstColumn = new Date(year, month, 1).getDay() + 1

  const todayDate = parseLocalDay(today)
  const atLastMonth = todayDate !== null && year * 12 + month >= todayDate.getFullYear() * 12 + todayDate.getMonth()

  function step(delta: number) {
    const next = month + delta
    if (next < 0) {
      setYear(year - 1)
      setMonth(11)
    } else if (next > 11) {
      setYear(year + 1)
      setMonth(0)
    } else {
      setMonth(next)
    }
  }

  return (
    <>
      <SheetHeader
        title={t.pickerTitle}
        titleId="day-picker-title"
        hint={t.pickerHint}
        onClose={onClose}
        closeLabel={strings.app.close}
      />

      <div className="mt-4 mb-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label={t.pickerPrevMonth}
          className="h-8 w-8 flex-none rounded-[10px] border border-stone-200 bg-stone-50 text-[15px] font-semibold text-stone-700 transition-colors hover:border-stone-900"
        >
          ‹
        </button>
        <div className="flex-1 text-center text-[14.5px] font-bold">
          {MONTHS[month]} {year}
        </div>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={atLastMonth}
          aria-label={t.pickerNextMonth}
          className="h-8 w-8 flex-none rounded-[10px] border border-stone-200 bg-stone-50 text-[15px] font-semibold text-stone-700 transition-colors not-disabled:hover:border-stone-900 disabled:text-stone-300"
        >
          ›
        </button>
      </div>

      <div aria-hidden="true" className="mb-1.5 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <span key={w} className="text-center text-[9.5px] font-bold tracking-[0.08em] text-stone-400">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const dayKey = key(day)
          const active = dayKey === selected
          const future = dayKey > today
          const marked = markedDays.has(dayKey)
          return (
            <button
              key={dayKey}
              type="button"
              disabled={future}
              aria-pressed={active}
              onClick={() => onPick(dayKey)}
              style={day === 1 ? { gridColumnStart: firstColumn } : undefined}
              className={`flex h-10 flex-col items-center justify-center gap-0.5 rounded-[11px] border ${
                active
                  ? 'border-stone-900 bg-stone-900 text-white'
                  : future
                    ? 'border-transparent text-stone-300'
                    : `bg-transparent text-stone-800 ${dayKey === today ? 'border-stone-300' : 'border-transparent'}`
              }`}
            >
              <span className="text-[13.5px] leading-none font-bold">{day}</span>
              <span
                aria-hidden="true"
                className={`h-1 w-1 rounded-full ${
                  marked ? (active ? 'bg-orange-400' : 'bg-orange-600') : 'bg-transparent'
                }`}
              />
            </button>
          )
        })}
      </div>

      <button type="button" onClick={() => onPick(today)} className={`mt-4 ${ctaInk}`}>
        {t.pickerJumpToday}
      </button>
    </>
  )
}
