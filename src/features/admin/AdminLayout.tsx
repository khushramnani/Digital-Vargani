import { Link, Outlet, useLocation } from 'react-router-dom'
import { strings } from '../../lib/strings'
import { supabase } from '../../lib/db/client'

const a = strings.admin
const t = strings.ledger

// Emoji + route are structure; labels come from strings.admin so the console
// stays translatable in one place.
type NavItem = { to: string; icon: string; label: string }

// "Collect donation" is the one prominent action (design F9): first orange item
// in the desktop rail and a fixed FAB on mobile — never a plain section pill,
// so an admin can log a donation in one tap from anywhere in the console.
const COLLECT: NavItem = { to: '/collect', icon: '🪔', label: a.collectDonationLink }

// The console's sections, in rail order (Dashboard first) — the same list backs
// the desktop rail and the mobile pill-tab row. Settings pins separately at the
// bottom of the rail / end of the pill row.
const NAV: NavItem[] = [
  { to: '/admin', icon: '📊', label: a.dashboardTitle },
  { to: '/admin/collections', icon: '🧾', label: a.collectionsLink },
  { to: '/admin/donors', icon: '👥', label: a.donorsLink },
  { to: '/admin/expenses', icon: '💸', label: a.expensesLink },
  { to: '/admin/handovers', icon: '🤝', label: a.handoversLink },
  { to: '/admin/cash-in-hand', icon: '💰', label: a.cashInHandLink },
  { to: '/admin/members', icon: '🧑‍🤝‍🧑', label: a.membersLink },
  { to: '/admin/transparency', icon: '🪷', label: a.transparencyLink },
]
const SETTINGS: NavItem = { to: '/admin/settings', icon: '⚙️', label: a.settingsLink }
const SECTIONS = [...NAV, SETTINGS]

// Dashboard '/admin' must match exactly or its prefix would swallow every other
// section; the rest light up on a startsWith so a future nested route (e.g.
// /admin/collections/:id) keeps its parent highlighted.
function isActive(pathname: string, to: string): boolean {
  return to === '/admin' ? pathname === '/admin' : pathname.startsWith(to)
}

function signOut() {
  void supabase.auth.signOut()
}

// The persistent treasurer console (v3 Step 3+4). One layout route with an
// <Outlet/>, so the dark rail (desktop) / sticky pill header (mobile) never
// disappears as an admin moves between sections — the fix for "the console
// exists on exactly one page". Volunteers never mount this; their flow keeps
// AppShell + the bottom tab bar, outside this route.
export function AdminLayout() {
  const { pathname } = useLocation()
  const activeSection = SECTIONS.find((s) => isActive(pathname, s.to)) ?? NAV[0]

  return (
    <div className="min-h-screen bg-stone-50 font-body text-stone-900 lg:flex">
      <DesktopRail pathname={pathname} />

      <div className="min-w-0 flex-1">
        <MobileHeader pathname={pathname} activeLabel={activeSection.label} />

        <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 pb-24 lg:px-8 lg:py-8 lg:pb-10">
          {/* Desktop page title (mobile gets it from the sticky header above). */}
          <h1 className="hidden font-display text-2xl font-extrabold tracking-tight text-stone-900 lg:block">
            {activeSection.label}
          </h1>
          <Outlet />
        </main>
      </div>

      {/* One-tap Collect from anywhere (mobile). Desktop uses the orange rail item. */}
      <Link
        to={COLLECT.to}
        className="fixed right-5 bottom-5 z-30 flex items-center gap-2 rounded-full bg-orange-600 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-orange-600/40 transition-colors hover:bg-orange-500 lg:hidden"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          {COLLECT.icon}
        </span>
        {COLLECT.label}
      </Link>
    </div>
  )
}

// Dark treasurer-console rail — desktop only.
function DesktopRail({ pathname }: { pathname: string }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 flex-none flex-col gap-6 bg-stone-900 px-4 py-6 text-stone-200 lg:flex">
      <div className="flex items-center gap-2.5 px-1">
        <div className="font-mark flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-lg font-extrabold text-stone-900 shadow-md shadow-orange-600/30">
          ॥
        </div>
        <div className="leading-tight">
          <div className="font-display text-[15px] font-extrabold tracking-tight text-white">{strings.landing.productName}</div>
          <div className="text-[9px] font-semibold tracking-widest text-stone-500 uppercase">{t.consoleTitle}</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        <RailLink item={COLLECT} prominent />
        {NAV.map((item) => (
          <RailLink key={item.to} item={item} active={isActive(pathname, item.to)} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 border-t border-stone-800 pt-3">
        <RailLink item={SETTINGS} active={isActive(pathname, SETTINGS.to)} />
        <button
          type="button"
          onClick={signOut}
          className="rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-stone-400 transition-colors hover:bg-stone-800 hover:text-white"
        >
          {strings.app.signOut}
        </button>
      </div>
    </aside>
  )
}

function RailLink({ item, active = false, prominent = false }: { item: NavItem; active?: boolean; prominent?: boolean }) {
  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
        prominent
          ? 'bg-orange-600 text-white hover:bg-orange-500'
          : active
            ? 'bg-stone-800 text-white'
            : 'text-stone-300 hover:bg-stone-800 hover:text-white'
      }`}
    >
      <span aria-hidden="true" className="flex-none text-lg">
        {item.icon}
      </span>
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

// Mobile console header: eyebrow + active section + sign-out, then a
// horizontally-scrollable pill-tab row that stays pinned while content scrolls.
function MobileHeader({ pathname, activeLabel }: { pathname: string; activeLabel: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/90 backdrop-blur lg:hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase">{t.consoleTitle}</p>
          <h1 className="truncate font-display text-lg font-extrabold tracking-tight text-stone-900">{activeLabel}</h1>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="flex-none rounded-lg px-2.5 py-1.5 text-sm font-semibold text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-stone-800"
        >
          {strings.app.signOut}
        </button>
      </div>

      <nav
        aria-label={t.consoleTitle}
        className="flex snap-x snap-proximity gap-2 overflow-x-auto px-4 pt-2.5 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SECTIONS.map((item) => {
          const active = isActive(pathname, item.to)
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={`flex-none snap-start rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                active ? 'bg-orange-600 text-white' : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
