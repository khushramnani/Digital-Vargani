import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { strings } from '../lib/strings'

// Branded frame shared by the login and onboarding screens, so both read as
// one product with the landing page: the same ॥ lockup, stone/amber palette,
// Bricolage display type and soft amber glow. Screens just drop their form
// into the centered card.
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-stone-50 font-body text-stone-900">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-24 h-96 w-96 rounded-full bg-amber-500/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-orange-500/10 blur-3xl"
      />

      <header className="relative z-10 px-6 py-5">
        <Link to="/" className="inline-flex items-center gap-2.5">
          <div className="font-mark flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-xl font-extrabold text-stone-900 shadow-lg shadow-orange-600/30">
            ॥
          </div>
          <div className="leading-tight">
            <div className="font-display text-[16px] font-extrabold tracking-tight">{strings.landing.productName}</div>
            <div className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase">
              {strings.landing.productSubtitle}
            </div>
          </div>
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <h1 className="font-display text-[28px] leading-tight font-extrabold tracking-tight text-stone-900">
              {title}
            </h1>
            {subtitle && <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-stone-500">{subtitle}</p>}
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xl shadow-stone-900/5 sm:p-7">
            {children}
          </div>
          {footer && <div className="mt-5">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
