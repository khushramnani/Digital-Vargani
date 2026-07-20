import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/db/client'
import { useAuth } from '../features/auth/useAuth'
import { strings } from '../lib/strings'
import { backLink as backLinkCls } from './ui'
import { isAdminRole } from '../lib/roles'
import { AnonUpgradeBanner } from './AnonUpgradeBanner'

// The frame every authenticated screen (admin + volunteer) sits in, so the app
// reads as one product with the landing/auth surfaces: the same ॥ lockup and
// stone/orange palette, a persistent top bar, and — for the first time — a way
// to sign out. Product register: restrained, familiar, out of the task's way.
// Public donor screens (receipt, transparency) deliberately don't use it.
//
// Sign-out just calls supabase.auth.signOut(); the resulting SIGNED_OUT event
// clears the session, and RequireRole bounces to /login on its own — no
// explicit navigation needed here.
export function AppShell({
  title,
  subtitle,
  back,
  actions,
  children,
}: {
  title: string
  subtitle?: string
  back?: { to: string; label: string }
  actions?: ReactNode
  children: ReactNode
}) {
  const { appUser } = useAuth()
  const home = isAdminRole(appUser?.role ?? '') ? '/admin' : '/collect'

  return (
    <div className="min-h-screen bg-stone-50 font-body text-stone-900">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/85 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Link to={home} className="inline-flex items-center gap-2.5">
            <div className="font-mark flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-lg font-extrabold text-stone-900 shadow-md shadow-orange-600/30">
              ॥
            </div>
            <div className="leading-tight">
              <div className="font-display text-[15px] font-extrabold tracking-tight">{strings.landing.productName}</div>
              <div className="text-[9px] font-semibold tracking-widest text-stone-400 uppercase">
                {strings.landing.productSubtitle}
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-stone-800"
          >
            {strings.app.signOut}
          </button>
        </div>
      </header>

      <AnonUpgradeBanner />

      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
        <div className="flex flex-col gap-2">
          {back && (
            <Link to={back.to} className={backLinkCls}>
              ← {back.label}
            </Link>
          )}
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-stone-900">{title}</h1>
            {actions}
          </div>
          {subtitle && <p className="text-[15px] text-stone-500">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}
