import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { strings } from '../../lib/strings'
import { supabase } from '../../lib/db/client'
import { Sheet } from '../../components/Sheet'
import { AnonUpgradeBanner } from '../../components/AnonUpgradeBanner'
import { closeRound, ctaQuiet, navPill } from '../../components/ui'

const a = strings.admin

// The console's sections, in tab order. `to` is the canonical URL — unchanged
// from before the redesign, so every deep link and every RequireRole guard keeps
// working; the pill row is presentation only.
//
// `alsoMatches` is how a section stays lit on a URL that isn't its own: the
// Collections tab hosts both the donations list and the donors view, and the
// design merges them into one destination with a segmented switch, while
// /admin/donors survives as a deep link.
type Section = { to: string; label: string; alsoMatches?: string[] }

const SECTIONS: Section[] = [
  { to: '/admin', label: a.tabs.overview },
  { to: '/admin/collections', label: a.tabs.collections, alsoMatches: ['/admin/donors'] },
  { to: '/admin/expenses', label: a.tabs.expenses },
  { to: '/admin/cash-in-hand', label: a.tabs.cash, alsoMatches: ['/admin/handovers'] },
  { to: '/admin/members', label: a.tabs.members },
  { to: '/admin/transparency', label: a.tabs.report },
  { to: '/admin/settings', label: a.tabs.settings },
]

// Screen title per section, keyed by the canonical URL.
const TITLES: Record<string, string> = {
  '/admin': a.titles.overview,
  '/admin/collections': a.titles.collections,
  '/admin/expenses': a.titles.expenses,
  '/admin/cash-in-hand': a.titles.cash,
  '/admin/members': a.titles.members,
  '/admin/transparency': a.titles.report,
  '/admin/settings': a.titles.settings,
}

// Dashboard '/admin' must match exactly or its prefix would swallow every other
// section; the rest light up on a startsWith so a future nested route (e.g.
// /admin/collections/:id) keeps its parent highlighted.
function matches(pathname: string, to: string): boolean {
  return to === '/admin' ? pathname === '/admin' : pathname.startsWith(to)
}

function isActive(pathname: string, section: Section): boolean {
  return matches(pathname, section.to) || (section.alsoMatches ?? []).some((p) => matches(pathname, p))
}

function signOut() {
  void supabase.auth.signOut()
}

// The persistent treasurer console. ONE layout route with an <Outlet/>, so the
// header and tab row never disappear as an admin moves between sections.
//
// Redesign 2026-08-18: one mobile console at every width, per the plan's IA —
// the design draws a single 412px phone, and a second desktop-rail layout was
// two shells to keep in step for a product that lives on phones. The content
// column is centred and capped so a laptop shows the same console rather than a
// stretched one; Sign out and the non-tab sections moved into the Menu sheet.
export function AdminLayout() {
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const active = SECTIONS.find((s) => isActive(pathname, s)) ?? SECTIONS[0]

  return (
    <div className="min-h-screen bg-stone-50 font-body text-stone-900">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/93 backdrop-blur-[10px]">
        <div className="mx-auto max-w-lg">
          <div className="flex items-end justify-between gap-2.5 px-4 pt-1.5">
            {/* The lockup links home; the screen title is a sibling <h1> rather
                than living inside that link, so every console screen has a real
                heading a screen reader can jump to. */}
            <Link to="/admin" aria-label={strings.landing.productName} className="flex-none">
              <span
                aria-hidden="true"
                className="font-mark flex h-[34px] w-[34px] items-center justify-center rounded-[11px] bg-linear-[150deg,var(--color-amber-500),var(--color-orange-600)] text-lg text-amber-950 shadow-[0_5px_12px_-6px_rgba(234,88,12,.6)]"
              >
                {a.logoMark}
              </span>
            </Link>
            <div className="min-w-0 flex-1">
              <p className="text-[9.5px] font-bold tracking-[0.15em] text-stone-400 uppercase">{a.consoleEyebrow}</p>
              <h1 className="font-display truncate text-xl leading-tight font-extrabold tracking-[-0.02em]">
                {TITLES[active.to] ?? a.titles.overview}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex h-8 flex-none items-center gap-1.5 rounded-[10px] border border-stone-200 bg-white px-2.5 text-xs font-bold text-stone-600 transition-colors hover:border-stone-300 hover:text-stone-900"
            >
              <span aria-hidden="true" className="flex flex-col gap-[2.5px]">
                <span className="block h-[1.6px] w-[13px] rounded-[2px] bg-current" />
                <span className="block h-[1.6px] w-[13px] rounded-[2px] bg-current" />
                <span className="block h-[1.6px] w-[13px] rounded-[2px] bg-current" />
              </span>
              {strings.app.menu}
            </button>
          </div>

          <div className="relative">
            <nav
              aria-label={strings.ledger.consoleTitle}
              className="flex gap-[7px] overflow-x-auto px-4 pt-2.5 pb-[11px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {SECTIONS.map((section) => {
                const on = isActive(pathname, section)
                return (
                  <Link
                    key={section.to}
                    to={section.to}
                    aria-current={on ? 'page' : undefined}
                    className={navPill(on)}
                  >
                    {section.label}
                  </Link>
                )
              })}
            </nav>
            {/* Fades the last pill out instead of clipping it, so the row reads
                as scrollable rather than broken. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 right-0 h-full w-[34px] bg-linear-to-r from-transparent to-stone-50"
            />
          </div>
        </div>
      </header>

      <AnonUpgradeBanner />

      <main className="mx-auto flex max-w-lg flex-col gap-3 px-4 pt-3 pb-28">
        <Outlet />
      </main>

      {/* One-tap Collect from anywhere. Hidden on Settings, where the sticky
          save bar owns the bottom-right corner. */}
      {active.to !== '/admin/settings' && (
        <Link
          to="/collect"
          className="fixed right-4 bottom-[22px] z-30 flex h-[46px] items-center gap-2.5 rounded-[14px] bg-stone-900 pr-[18px] pl-[15px] text-[13.5px] font-bold tracking-[-0.01em] text-white shadow-[0_12px_26px_-12px_rgba(28,25,23,.65)] transition-colors hover:bg-orange-600"
        >
          <span aria-hidden="true" className="relative block h-[15px] w-[15px]">
            <span className="absolute top-[6.7px] left-0 h-[1.6px] w-[15px] rounded-[2px] bg-current" />
            <span className="absolute top-0 left-[6.7px] h-[15px] w-[1.6px] rounded-[2px] bg-current" />
          </span>
          {a.collectFab}
        </Link>
      )}

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} labelledBy="console-menu-title">
        <div className="flex items-start gap-2.5">
          <h2
            id="console-menu-title"
            className="font-display min-w-0 flex-1 text-lg font-extrabold tracking-[-0.02em] text-stone-900"
          >
            {a.menuTitle}
          </h2>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            aria-label={strings.app.close}
            className={closeRound}
          >
            ✕
          </button>
        </div>
        <div className="mt-2 flex flex-col">
          {/* The two destinations the tab row doesn't carry. Both keep their own
              URLs; the Cash tab shows the handover LOG, this is the form that
              records one. */}
          {[
            { to: '/collect/pending', label: a.menuPendingSends },
            { to: '/admin/handovers', label: a.menuHandovers },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 border-t border-stone-100 py-3.5 text-left text-[14.5px] font-semibold text-stone-800 transition-colors hover:text-orange-600"
            >
              <span className="flex-1">{item.label}</span>
              <span aria-hidden="true" className="text-base text-stone-300">
                ›
              </span>
            </Link>
          ))}
          <button
            type="button"
            onClick={signOut}
            className="border-t border-stone-100 py-3.5 text-left text-[14.5px] font-semibold text-stone-500 transition-colors hover:text-stone-800"
          >
            {strings.app.signOut}
          </button>
          <button type="button" onClick={() => setMenuOpen(false)} className={`mt-3.5 ${ctaQuiet}`}>
            {strings.app.close}
          </button>
        </div>
      </Sheet>
    </div>
  )
}
