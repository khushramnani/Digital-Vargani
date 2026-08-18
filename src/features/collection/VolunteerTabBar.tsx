import { Link, useLocation } from 'react-router-dom'
import { strings } from '../../lib/strings'

// The volunteer's primary navigation: a fixed bottom tab bar, better one-handed
// than link-chips and the answer to the back-button complaint on the volunteer
// side. Rendered ONLY for role === 'volunteer' by each screen (CollectionForm/
// PendingSend/Collections/CashInHand) — admins navigate via the console's own tab
// row instead. Screens that mount this add trailing bottom padding so nothing
// hides behind it.
//
// Part 4 of the 2026-08-18 plan: the emoji glyphs are gone. The design's own
// vocabulary is text, so each tab is now its label alone — one word, larger and
// legible, with an orange rule marking the active one.
const t = strings.collection

type Tab = {
  to: string
  label: string
  // Kept short and visible; a descriptive aria-label is only set where the tab's
  // job isn't obvious from one word (and keeps existing e2e selectors like
  // getByRole('link', {name:'Pending sends'}) pointing at it).
  ariaLabel?: string
  isActive: (path: string) => boolean
}

const TABS: Tab[] = [
  { to: '/collect', label: 'Collect', isActive: (p) => p === '/collect' },
  {
    to: '/collect/pending',
    label: 'Send',
    ariaLabel: t.pendingSendLink,
    isActive: (p) => p.startsWith('/collect/pending'),
  },
  {
    to: '/collect/history',
    label: 'Mine',
    ariaLabel: t.collectionsLink,
    isActive: (p) => p.startsWith('/collect/history'),
  },
  {
    to: '/volunteer/cash-in-hand',
    label: 'Cash',
    ariaLabel: t.cashInHandLink,
    isActive: (p) => p.includes('cash-in-hand'),
  },
  {
    to: '/volunteer/expenses',
    label: 'More',
    ariaLabel: t.expensesLink,
    // "More" is the catch-all for the non-primary volunteer screens, so it stays
    // lit on both Expenses and Handover (both mount the tab bar).
    isActive: (p) => p.includes('/expenses') || p.includes('/handover'),
  },
]

export function VolunteerTabBar() {
  const { pathname } = useLocation()
  return (
    <nav
      aria-label={strings.landing.productName}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-lg">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname)
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-label={tab.ariaLabel}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-1 items-center justify-center py-3.5 text-[12.5px] font-bold transition-colors ${
                active ? 'text-orange-600' : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              {tab.label}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-4 top-0 h-[2px] rounded-full bg-orange-600"
                />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
