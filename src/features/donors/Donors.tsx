import { useEffect, useState } from 'react'
import { getDonorsSummary, type DonorSummary } from '../../lib/db/donors'
import { getDonations, type Donation } from '../../lib/db/donations'
import { fetchMandalUserNames } from '../../lib/db/users'
import { formatForDisplay, normalizeToE164, waDigits } from '../../lib/phone'
import { formatINR } from '../../lib/money'
import { strings } from '../../lib/strings'
import { card } from '../../components/ui'

const sd = strings.donors

// "who gave what, this year and last" — the admin donor directory (plan v4 §1b).
// Content-only: rendered inside AdminLayout's <Outlet/> at /admin/donors, so the
// console frame (title/rail) comes from the layout, not here.
//
// Two fetches: the year-scoped SUMMARY (getDonorsSummary, refetched when the
// year filter changes — the RPC aggregates server-side) drives the rows; the
// full donation list (getDonations, fetched once) supplies the year-picker
// options and the per-donor history a row expands to show. Both are RLS-scoped
// to this mandal and admin-only, so nothing leaks across tenants.
export function DonorsContent() {
  const [year, setYear] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [donors, setDonors] = useState<DonorSummary[]>([])
  const [donations, setDonations] = useState<Donation[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [yearOptions, setYearOptions] = useState<number[]>([])

  // Full donation list + volunteer names: fetched once. Used for the year-picker
  // options and the history expansion (below); independent of the year filter.
  useEffect(() => {
    let active = true
    Promise.all([getDonations(), fetchMandalUserNames()])
      .then(([d, n]) => {
        if (!active) return
        setDonations(d)
        setNames(n)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      active = false
    }
  }, [])

  // Donor summary — refetched whenever the year filter changes.
  useEffect(() => {
    let active = true
    setLoading(true)
    getDonorsSummary(year ?? undefined)
      .then((rows) => {
        if (!active) return
        setDonors(rows)
        // Year options come from the summary's own first/last dates, captured
        // from the UNFILTERED load only. The RPC aggregates every donation,
        // whereas getDonations() is capped at 1000 rows — deriving the picker
        // from that array made a large mandal's older seasons disappear from
        // the list entirely. Capturing only when year == null keeps the options
        // stable; recomputing while filtered would collapse them to one year.
        if (year == null) {
          const ys = rows.flatMap((r) => [new Date(r.firstAt).getFullYear(), new Date(r.lastAt).getFullYear()])
          if (ys.length > 0) {
            const max = Math.max(...ys)
            const min = Math.min(...ys)
            setYearOptions(Array.from({ length: max - min + 1 }, (_, i) => max - i))
          }
        }
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
  }, [year])

  // Newest first; populated from the unfiltered donor summary above.
  const years = yearOptions

  const q = search.trim().toLowerCase()
  const visible = q
    ? donors.filter((d) => d.donorName.toLowerCase().includes(q) || (d.donorPhone ?? '').includes(q))
    : donors

  return (
    <>
      <p className="text-sm text-stone-500">{sd.subtitle}</p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={sd.searchPlaceholder}
          aria-label={sd.searchPlaceholder}
          className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-orange-400 focus:outline-none"
        />
        <select
          value={year ?? ''}
          onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
          aria-label={sd.yearFilterLabel}
          className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 focus:border-orange-400 focus:outline-none"
        >
          <option value="">{sd.allYears}</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
          {sd.empty}
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visible.map((donor) => (
            <DonorRow
              key={donor.donorKey}
              donor={donor}
              donations={donations}
              names={names}
              year={year}
              open={expanded === donor.donorKey}
              onToggle={() => setExpanded((k) => (k === donor.donorKey ? null : donor.donorKey))}
            />
          ))}
        </ul>
      )}
    </>
  )
}

// Mirrors the RPC's grouping key exactly:
//   coalesce(nullif(btrim(donor_phone),''), lower(btrim(donor_name)))
// so the expanded history can never disagree with the row's own totals. The
// name branch MUST also require the donation to be phone-less — otherwise a
// phone-less "Ramesh Patel" would absorb a *different*, phone-keyed Ramesh
// Patel's donations, showing one person's giving under another's name (and a
// history that contradicts the header count).
function belongsTo(dn: Donation, donor: DonorSummary): boolean {
  // normalizeToE164 mirrors the RPC's normalize_phone_e164, so a legacy
  // '9876543210' row and its post-v4 '+919876543210' twin land on the same
  // donor here exactly as they do in the aggregate.
  const phone = normalizeToE164(dn.donor_phone ?? '')
  if (donor.donorPhone) return phone === donor.donorPhone
  return phone === '' && (dn.donor_name ?? '').trim().toLowerCase() === donor.donorKey
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function DonorRow({
  donor,
  donations,
  names,
  year,
  open,
  onToggle,
}: {
  donor: DonorSummary
  donations: Donation[]
  names: Record<string, string>
  year: number | null
  open: boolean
  onToggle: () => void
}) {
  const name = donor.donorName.trim() || sd.anonymous
  const e164 = normalizeToE164(donor.donorPhone ?? '')

  // Their non-voided donations, honouring the active year filter so the history
  // never contradicts the year-scoped total above it.
  const history = donations.filter(
    (dn) => !dn.voided && belongsTo(dn, donor) && (year == null || new Date(dn.created_at).getFullYear() === year),
  )

  return (
    <li className={`${card} overflow-hidden`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-stone-50"
      >
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-800">
          {name.charAt(0).toUpperCase() || '?'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-stone-900">{name}</p>
          <p className="mt-0.5 text-xs text-stone-500">
            {sd.firstLabel} {fmtDate(donor.firstAt)} · {sd.lastLabel} {fmtDate(donor.lastAt)}
          </p>
        </div>
        <div className="flex-none text-right">
          <p className="font-bold tabular-nums text-stone-900">{formatINR(donor.totalPaise)}</p>
          <p className="text-xs text-stone-500">
            {donor.donationCount} {sd.donationsLabel}
          </p>
        </div>
      </button>

      <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 px-4 py-2.5">
        {e164 ? (
          <>
            <span className="mr-1 text-xs tabular-nums text-stone-500">{formatForDisplay(e164)}</span>
            <a
              href={`tel:${e164}`}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50"
            >
              {sd.call}
            </a>
            <a
              href={`https://wa.me/${waDigits(e164)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100"
            >
              {sd.whatsApp}
            </a>
          </>
        ) : (
          <span className="text-xs text-stone-400">{sd.noPhone}</span>
        )}
      </div>

      {open && (
        <div className="border-t border-stone-100 bg-stone-50/60 px-4 py-3">
          <p className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">{sd.historyTitle}</p>
          <ul className="flex flex-col gap-1.5">
            {history.map((dn) => (
              <li key={dn.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-stone-600">
                  {fmtDate(dn.created_at)} · <span className="capitalize">{dn.mode}</span>
                  {names[dn.collected_by] ? ` · ${names[dn.collected_by]}` : ''}
                </span>
                <span className="flex-none font-semibold tabular-nums text-stone-800">{formatINR(dn.amount_paise)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}
