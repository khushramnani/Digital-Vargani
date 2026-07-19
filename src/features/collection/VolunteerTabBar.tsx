import { Link, useLocation } from 'react-router-dom'
import { strings } from '../../lib/strings'

// The volunteer's primary navigation (design-ref "Volunteer app"): a fixed
// bottom tab bar, better one-handed than the old link-chips and the answer to
// the back-button complaint on the volunteer side. Rendered ONLY for
// role === 'volunteer' by each screen (CollectionForm/PendingSend/Collections/
// CashInHand) — admins navigate via AppShell's back link instead. Screens that
// mount this add trailing bottom padding so nothing hides behind it.
const t = strings.collection

type Tab = {
  to: string
  label: string
  icon: string
  // Kept short and visible; a descriptive aria-label is only set where the
  // tab's job isn't obvious from one word (and keeps existing e2e selectors
  // like getByRole('link', {name:'Pending sends'}) pointing at it).
  ariaLabel?: string
  isActive: (path: string) => boolean
}

const TABS: Tab[] = [
  { to: '/collect', label: 'Collect', icon: '＋', isActive: (p) => p === '/collect' },
  {
    to: '/collect/pending',
    label: 'Send',
    icon: '💬',
    ariaLabel: t.pendingSendLink,
    isActive: (p) => p.startsWith('/collect/pending'),
  },
  {
    to: '/collect/history',
    label: 'Mine',
    icon: '🧾',
    ariaLabel: t.collectionsLink,
    isActive: (p) => p.startsWith('/collect/history'),
  },
  {
    to: '/volunteer/cash-in-hand',
    label: 'Cash',
    icon: '💰',
    ariaLabel: t.cashInHandLink,
    isActive: (p) => p.includes('cash-in-hand'),
  },
  {
    to: '/volunteer/expenses',
    label: 'More',
    icon: '⋯',
    ariaLabel: t.expensesLink,
    // "More" is the catch-all for the non-primary volunteer screens, so it
    // stays lit on both Expenses and Handover (both mount the tab bar).
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
      <div className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname)
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-label={tab.ariaLabel}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors ${
                active ? 'text-orange-600' : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              <span aria-hidden="true" className="text-xl leading-none">
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
