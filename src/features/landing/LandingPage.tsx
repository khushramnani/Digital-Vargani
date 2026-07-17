import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { strings } from '../../lib/strings'
import { formatINR } from '../../lib/money'
import { DemoPhone } from './DemoPhone'
import { ReceiptCard } from './ReceiptCard'
import { FundDonut } from '../../components/FundDonut'

const t = strings.landing

const REVEAL = 'opacity-0 translate-y-6 transition-all duration-700 ease-out'

// Fades sections up into view as they scroll on screen. Plain DOM query
// (not per-section refs) since it's a one-time decorative pass over static
// marketing content, not something that needs to react to prop changes.
function useScrollReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!('IntersectionObserver' in window) || els.length === 0) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.remove('opacity-0', 'translate-y-6')
            io.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

export function LandingPage() {
  useScrollReveal()

  return (
    <div className="overflow-x-hidden bg-stone-50 font-body text-stone-900">
      <Nav />
      <Hero />
      <StatStrip />
      <WhatItIs />
      <Features />
      <HowItWorks />
      <MultiMandal />
      <Transparency />
      <Multilingual />
      <FinalCta />
      <Footer />
    </div>
  )
}

function Logo() {
  return (
    <Link to="/" className="flex flex-none flex-col leading-none">
      {/* Wordmark, not an icon: Marcellus (already loaded as --font-mark) with
          the brand gradient clipped into the text carries the identity on its
          own, so there's no logo glyph to design, localise, or keep in sync. */}
      <span className="font-mark bg-gradient-to-br from-amber-500 to-orange-600 bg-clip-text pr-0.5 text-[23px] tracking-tight text-transparent">
        {t.productName}
      </span>
      <span className="mt-0.5 text-[10px] font-semibold tracking-widest text-stone-400 uppercase">
        {t.productSubtitle}
      </span>
    </Link>
  )
}

function Nav() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-stone-200 bg-stone-50/85 backdrop-blur-md">
      {/* justify-between is load-bearing on mobile: the centre <nav> is
          display:none below md, so without it the logo and hamburger — both
          flex-none — bunch on the left half. px-6 matches every section below,
          so the logo lines up with the hero text. */}
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-5 px-6 py-3">
        <Logo />
        <nav className="hidden flex-1 items-center justify-center gap-8 md:flex">
          <a href="#what" className="text-sm font-semibold text-stone-600 hover:text-orange-600">
            {t.nav.whatItIs}
          </a>
          <a href="#features" className="text-sm font-semibold text-stone-600 hover:text-orange-600">
            {t.nav.features}
          </a>
          <a href="#how" className="text-sm font-semibold text-stone-600 hover:text-orange-600">
            {t.nav.howItWorks}
          </a>
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Link to="/login" className="flex h-10.5 items-center rounded-lg px-4 text-sm font-bold text-stone-800 hover:text-orange-600">
            {t.nav.login}
          </Link>
          <a
            href="#cta"
            className="flex h-10.5 items-center rounded-lg bg-stone-900 px-5 text-sm font-bold text-stone-50 hover:bg-orange-600 hover:text-white"
          >
            {t.nav.startFree}
          </a>
        </div>
        <button
          type="button"
          aria-label="Toggle menu"
          onClick={() => setOpen((o) => !o)}
          className="flex h-11 w-11 flex-none flex-col items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white hover:border-orange-600 md:hidden"
        >
          <span
            className={`h-0.5 w-4.5 rounded-full bg-stone-800 transition-transform ${open ? 'translate-y-2 rotate-45' : ''}`}
          />
          <span className={`h-0.5 w-4.5 rounded-full bg-stone-800 transition-opacity ${open ? 'opacity-0' : ''}`} />
          <span
            className={`h-0.5 w-4.5 rounded-full bg-stone-800 transition-transform ${open ? '-translate-y-2 -rotate-45' : ''}`}
          />
        </button>
      </div>
      {open && (
        <div className="border-t border-stone-200 bg-stone-50 px-6 pt-2 pb-4.5 md:hidden">
          <a
            href="#what"
            onClick={() => setOpen(false)}
            className="block border-b border-stone-200 py-3.5 text-base font-semibold text-stone-800"
          >
            {t.nav.whatItIs}
          </a>
          <a
            href="#features"
            onClick={() => setOpen(false)}
            className="block border-b border-stone-200 py-3.5 text-base font-semibold text-stone-800"
          >
            {t.nav.features}
          </a>
          <a
            href="#how"
            onClick={() => setOpen(false)}
            className="block border-b border-stone-200 py-3.5 text-base font-semibold text-stone-800"
          >
            {t.nav.howItWorks}
          </a>
          <div className="mt-3.5 flex gap-2.5">
            <Link
              to="/login"
              className="flex-1 rounded-xl border border-stone-200 py-3 text-center text-sm font-bold text-stone-800"
            >
              {t.nav.login}
            </Link>
            <a
              href="#cta"
              onClick={() => setOpen(false)}
              className="flex-1 rounded-xl bg-orange-600 py-3 text-center text-sm font-bold text-white"
            >
              {t.nav.startFree}
            </a>
          </div>
        </div>
      )}
    </header>
  )
}

function Hero() {
  const avatars = [
    { init: 'V', className: 'bg-orange-600' },
    { init: 'E', className: 'bg-amber-700' },
    { init: 'G', className: 'bg-stone-600' },
    { init: '+', className: 'bg-stone-400' },
  ]

  return (
    <section className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 pt-16 pb-10 lg:grid-cols-[1.05fr_0.95fr]">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-30 -z-0 h-130 w-130 rounded-full bg-amber-500/20 blur-3xl"
      />
      <div className="relative z-10">
        <div className="mb-5.5 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-100 px-3.5 py-1.5 text-xs font-bold text-amber-800">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-600" />
          {t.hero.badge}
        </div>
        <h1 className="font-display mb-5 text-[36px] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-[46px] lg:text-[60px]">
          {t.hero.titleLead}
          <span className="text-orange-600">{t.hero.titleHighlight}</span>
        </h1>
        <p className="font-serif mb-7.5 max-w-lg text-lg leading-relaxed text-stone-600 text-pretty">
          {t.hero.subtitle}
        </p>
        <div className="mb-8.5 flex flex-wrap gap-3.5">
          <a
            href="#cta"
            className="flex h-13.5 items-center rounded-xl bg-orange-600 px-6.5 text-base font-bold text-white shadow-lg shadow-orange-600/40 hover:bg-stone-900"
          >
            {t.hero.ctaPrimary}
          </a>
          <a
            href="#how"
            className="flex h-13.5 items-center rounded-xl border border-stone-200 bg-white px-6 text-base font-bold text-stone-800 hover:border-orange-600 hover:text-orange-600"
          >
            {t.hero.ctaSecondary}
          </a>
        </div>
        <div className="flex items-center gap-3.5">
          <div className="flex">
            {avatars.map((a, i) => (
              <div
                key={i}
                className={`-ml-2 flex h-8.5 w-8.5 items-center justify-center rounded-full border-2 border-stone-50 text-xs font-bold text-white ${a.className}`}
              >
                {a.init}
              </div>
            ))}
          </div>
          <div className="text-[13px] leading-snug font-semibold text-stone-500">
            {t.hero.trustLine1}
            <br />
            <span className="font-medium text-stone-400">{t.hero.trustLine2}</span>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex justify-center">
        <DemoPhone />
      </div>
    </section>
  )
}

function StatStrip() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-4">
      <div className="grid grid-cols-2 gap-5.5 rounded-3xl bg-stone-900 px-5 py-6.5 sm:grid-cols-4 sm:gap-2 sm:px-5 sm:py-7.5">
        {t.stats.map((s) => (
          <div key={s.label} className="px-2 py-1 text-center">
            <div className="font-display text-3xl font-extrabold tracking-tight text-amber-500">{s.value}</div>
            <div className="mt-0.5 text-xs font-medium text-stone-400">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SectionEyebrow({ children }: { children: string }) {
  return (
    <div className="mb-3.5 text-[13px] font-bold tracking-[0.16em] text-orange-700 uppercase">{children}</div>
  )
}

function WhatItIs() {
  return (
    <section id="what" className="mx-auto max-w-6xl px-6 py-16 sm:py-21">
      <div data-reveal className={`mx-auto mb-13 max-w-2xl text-center ${REVEAL}`}>
        <SectionEyebrow>{t.whatItIs.eyebrow}</SectionEyebrow>
        <h2 className="font-display mb-4 text-[31px] leading-[1.1] font-bold tracking-tight sm:text-[40px]">
          {t.whatItIs.title}
        </h2>
        <p className="font-serif text-lg leading-relaxed text-stone-600 text-pretty">{t.whatItIs.body}</p>
      </div>
      <div
        data-reveal
        className={`mx-auto grid max-w-3xl grid-cols-1 items-center gap-5 lg:grid-cols-[1fr_auto_1fr] ${REVEAL}`}
      >
        <div className="rounded-2xl border border-stone-200 bg-white p-6.5 shadow-lg">
          <div className="mb-3.5 text-xs font-bold tracking-wider text-red-700 uppercase">
            {t.whatItIs.beforeLabel}
          </div>
          {t.whatItIs.before.map((line) => (
            <div key={line} className="flex items-center gap-2.5 py-1.5 text-[15px] font-medium text-stone-600">
              <span className="text-base text-red-600">✕</span>
              {line}
            </div>
          ))}
        </div>
        <div className="mx-auto flex h-12 w-12 flex-none rotate-90 items-center justify-center rounded-full bg-orange-600 text-xl text-white shadow-lg shadow-orange-600/40 lg:rotate-0">
          →
        </div>
        <div className="rounded-2xl bg-stone-900 p-6.5 shadow-lg">
          <div className="mb-3.5 text-xs font-bold tracking-wider text-amber-500 uppercase">
            {t.whatItIs.afterLabel}
          </div>
          {t.whatItIs.after.map((line) => (
            <div key={line} className="flex items-center gap-2.5 py-1.5 text-[15px] font-medium text-stone-200">
              <span className="text-emerald-400">✓</span>
              {line}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const FEATURE_ICON_STYLE = [
  'bg-amber-100',
  'bg-blue-100',
  'bg-emerald-100',
  'bg-violet-100',
  'bg-amber-100',
  'bg-orange-100',
]

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-16.5">
      <div data-reveal className={`mb-10 ${REVEAL}`}>
        <SectionEyebrow>{t.features.eyebrow}</SectionEyebrow>
        <h2 className="font-display max-w-xl text-[31px] leading-[1.1] font-bold tracking-tight sm:text-[40px]">
          {t.features.title}
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-4.5 sm:grid-cols-2 lg:grid-cols-3">
        {t.features.items.map((f, i) => (
          <div
            key={f.title}
            data-reveal
            className={`relative rounded-2xl border border-stone-200 bg-white p-6.5 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl ${REVEAL}`}
          >
            {f.isNew && (
              <span className="absolute top-5 right-5 rounded-full bg-orange-600 px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-white uppercase">
                NEW
              </span>
            )}
            <div
              className={`mb-4 flex h-12.5 w-12.5 items-center justify-center rounded-2xl text-2xl ${FEATURE_ICON_STYLE[i % FEATURE_ICON_STYLE.length]}`}
            >
              {f.icon}
            </div>
            <div className="font-display mb-2 text-lg font-bold tracking-tight">{f.title}</div>
            <div className="text-[15px] leading-relaxed text-stone-500">{f.desc}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section id="how" className="mt-15 bg-stone-900">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div data-reveal className={`mx-auto mb-14 max-w-xl text-center ${REVEAL}`}>
          <div className="mb-3.5 text-[13px] font-bold tracking-[0.16em] text-amber-500 uppercase">
            {t.howItWorks.eyebrow}
          </div>
          <h2 className="font-display text-[31px] leading-[1.1] font-bold tracking-tight text-stone-50 sm:text-[40px]">
            {t.howItWorks.title}
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {t.howItWorks.steps.map((s) => (
            <div
              key={s.n}
              data-reveal
              className={`rounded-2xl border border-stone-800 bg-stone-800/60 p-7.5 ${REVEAL}`}
            >
              <div className="font-display mb-4.5 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-xl font-extrabold text-stone-900">
                {s.n}
              </div>
              <div className="font-display mb-2 text-xl font-bold tracking-tight text-stone-50">{s.title}</div>
              <div className="text-[15px] leading-relaxed text-stone-400">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const MANDALS = [
  { name: 'Vinayak Yuvak Mandal', area: 'Gujarat', init: 'VY', dot: 'bg-orange-600' },
  { name: 'Ekvira Devi Mandal', area: 'Mumbai', init: 'ED', dot: 'bg-amber-700' },
  { name: 'Shree Ganesh Tarun Mandal', area: 'Ahmedabad', init: 'GT', dot: 'bg-stone-600' },
]

const MANDAL_CYCLE_MS = 3200

function MultiMandal() {
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setActiveIdx((i) => (i + 1) % MANDALS.length), MANDAL_CYCLE_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <section id="mandals" className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-13 px-6 py-14 lg:grid-cols-[0.9fr_1.1fr] lg:py-21.5">
      <div data-reveal className={REVEAL}>
        <div className="mb-4.5 inline-flex items-center gap-2 rounded-full bg-orange-600 px-3.5 py-1.5 text-[11px] font-extrabold tracking-wider text-white">
          {t.multiMandal.badge}
        </div>
        <h2 className="font-display mb-4 text-[31px] leading-[1.1] font-bold tracking-tight sm:text-[40px]">
          {t.multiMandal.title}
        </h2>
        <p className="font-serif mb-6 text-lg leading-relaxed text-stone-600 text-pretty">{t.multiMandal.body}</p>
        <div className="grid gap-3">
          {t.multiMandal.points.map((p) => (
            <div key={p} className="flex items-center gap-2.5 text-[15px] font-semibold text-stone-800">
              <span className="flex h-6.5 w-6.5 flex-none items-center justify-center rounded-lg bg-amber-100 text-sm text-orange-700">
                ✓
              </span>
              {p}
            </div>
          ))}
        </div>
      </div>
      <div data-reveal className={REVEAL}>
        <div className="rounded-3xl border border-stone-200 bg-white p-5.5 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="font-display text-[15px] font-bold">{t.multiMandal.panelTitle}</div>
              <div className="text-xs font-medium text-stone-400">{t.multiMandal.panelSubtitle}</div>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" />
              {t.multiMandal.moreJoining}
            </div>
          </div>
          {MANDALS.map((m, i) => {
            const active = i === activeIdx
            return (
              <div
                key={m.name}
                className={`mb-2 flex items-center gap-3 rounded-2xl border p-3.5 transition-colors ${active ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'}`}
              >
                <div
                  className={`font-display flex h-10 w-10 flex-none items-center justify-center rounded-xl text-sm font-extrabold text-white ${m.dot}`}
                >
                  {m.init}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{m.name}</div>
                  <div className="text-xs font-medium text-stone-400">{m.area}</div>
                </div>
                {active && (
                  <div className="flex flex-none items-center gap-1.5 text-[11px] font-bold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                    {t.multiMandal.activeLabel}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function Transparency() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <div
        data-reveal
        className={`grid grid-cols-1 items-center gap-10 rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-100 to-stone-100 p-8.5 sm:p-11 lg:grid-cols-2 ${REVEAL}`}
      >
        <div>
          <SectionEyebrow>{t.transparency.eyebrow}</SectionEyebrow>
          <h2 className="font-display mb-3.5 text-[28px] leading-[1.14] font-bold tracking-tight">
            {t.transparency.title}
          </h2>
          <p className="font-serif mb-5.5 text-[17px] leading-relaxed text-stone-600 text-pretty">
            {t.transparency.body}
          </p>
          {/* Slug-addressed since multi-tenancy: bare /transparency is no
              longer a route. Points at the published demo mandal. */}
          <Link
            to="/transparency/demo"
            className="inline-flex h-12 items-center rounded-xl bg-stone-900 px-5.5 text-sm font-bold text-stone-50 hover:bg-orange-600"
          >
            {t.transparency.cta}
          </Link>
        </div>
        <div className="flex justify-center">
          <ReportPreview />
        </div>
      </div>
    </section>
  )
}

// Honest preview of the real public report (see TransparencyReport.tsx) — the
// same paper-and-donut visual with sample numbers, not the donation receipt
// this slot used to show. Kept as a lightweight static mirror rather than
// rendering the live component so the marketing page pulls in no data layer.
function ReportPreview() {
  const s = t.transparency.sample
  const segments = s.categories.map((c) => ({ name: c.name, value: c.value * 100, color: c.color }))
  const totalPaise = segments.reduce((sum, seg) => sum + seg.value, 0)

  return (
    <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-amber-200/70 bg-[#f7f0e1] p-6 shadow-xl">
      <div className="text-center">
        <p className="text-xs tracking-[0.22em] text-amber-700">॥ श्री गणेशाय नमः ॥</p>
        <div className="font-serif mt-1.5 text-2xl font-semibold text-stone-800">{t.demoPhone.mandalName}</div>
        <p className="mt-1 text-[10px] font-semibold tracking-[0.2em] text-stone-400 uppercase">{s.eyebrow}</p>
      </div>
      <div className="mt-5 rounded-2xl border border-amber-200/70 bg-[#fbf6ea] px-4 py-5 text-center">
        <p className="text-[10px] font-semibold tracking-[0.16em] text-stone-500 uppercase">{s.totalLabel}</p>
        <p className="font-serif mt-1.5 text-4xl font-semibold text-emerald-700">{formatINR(totalPaise)}</p>
        <p className="font-serif mt-1.5 text-xs text-stone-500 italic">{s.totalNote}</p>
      </div>
      <h3 className="font-serif mt-6 mb-5 text-center text-base font-semibold text-stone-800">{s.usageTitle}</h3>
      <FundDonut segments={segments} size={148} />
    </div>
  )
}

function Multilingual() {
  const [lang, setLang] = useState(t.multilingual.langs[0].code)
  const receiptText = t.multilingual.translations[lang as keyof typeof t.multilingual.translations]

  return (
    <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-13 px-6 py-12 lg:grid-cols-[1.05fr_0.95fr]">
      <div data-reveal className={REVEAL}>
        <div className="mb-4.5 inline-flex items-center gap-2 rounded-full bg-orange-600 px-3.5 py-1.5 text-[11px] font-extrabold tracking-wider text-white">
          {t.multilingual.badge}
        </div>
        <h2 className="font-display mb-4 text-[31px] leading-[1.1] font-bold tracking-tight sm:text-[40px]">
          {t.multilingual.title}
        </h2>
        <p className="font-serif mb-6 text-lg leading-relaxed text-stone-600 text-pretty">{t.multilingual.body}</p>
        <div className="grid gap-3">
          {t.multilingual.points.map((p) => (
            <div key={p} className="flex items-center gap-2.5 text-[15px] font-semibold text-stone-800">
              <span className="flex h-6.5 w-6.5 flex-none items-center justify-center rounded-lg bg-amber-100 text-sm text-orange-700">
                ✓
              </span>
              {p}
            </div>
          ))}
        </div>
      </div>
      <div data-reveal className={`flex flex-col items-center ${REVEAL}`}>
        <div className="w-full max-w-90 rounded-3xl border border-stone-200 bg-white p-4.5 shadow-xl">
          <div className="mb-2.5 px-0.5 text-[11px] font-bold tracking-wider text-stone-400 uppercase">
            {t.multilingual.sendInLabel}
          </div>
          <div className="mb-4 flex gap-2">
            {t.multilingual.langs.map((l) => {
              const active = l.code === lang
              return (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => setLang(l.code)}
                  className={`flex-1 rounded-xl border px-1 py-2.5 text-center transition-colors ${active ? 'border-orange-600 bg-orange-50' : 'border-stone-200 bg-white'}`}
                >
                  <div className={`text-sm font-bold ${active ? 'text-orange-600' : 'text-stone-800'}`}>
                    {l.native}
                  </div>
                  <div
                    className={`mt-0.5 text-[9px] font-semibold tracking-wide uppercase ${active ? 'text-orange-500' : 'text-stone-400'}`}
                  >
                    {l.tag}
                  </div>
                </button>
              )
            })}
          </div>
          <ReceiptCard
            mark={t.demoPhone.mark}
            mandalName={t.demoPhone.mandalName}
            subtitle={receiptText.subtitle}
            noLabel={receiptText.noLabel}
            donorLabel={receiptText.donorLabel}
            amountLabel={receiptText.amountLabel}
            receiptNo="VYM-1042"
            donorName="Anjali Kulkarni"
            amountRupees={501}
            thanks={`${receiptText.thanks} 🙏`}
          />
          <div className="mt-3.5 flex gap-2">
            <div className="flex h-11 flex-1 items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white">
              {t.multilingual.sendWhatsapp}
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-stone-900 text-lg text-white">
              ✉
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section id="cta" className="mx-auto max-w-6xl px-6 pt-10">
      <div
        data-reveal
        className={`relative overflow-hidden rounded-3xl bg-stone-900 px-6 py-13.5 text-center sm:px-10 lg:py-17.5 ${REVEAL}`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 left-1/2 h-75 w-150 -translate-x-1/2 rounded-full bg-amber-500/25 blur-3xl"
        />
        <div className="relative">
          <div className="font-mark mb-1.5 text-4xl text-amber-500">{t.finalCta.mark}</div>
          <h2 className="font-display mx-auto mb-4 max-w-2xl text-[31px] leading-[1.08] font-extrabold tracking-tight text-balance text-stone-50 sm:text-[44px]">
            {t.finalCta.title}
          </h2>
          <p className="font-serif mx-auto mb-7.5 max-w-lg text-lg leading-relaxed text-stone-400">
            {t.finalCta.body}
          </p>
          <Link
            to="/signup"
            className="inline-flex h-14 items-center rounded-2xl bg-orange-600 px-7.5 text-[17px] font-bold text-white shadow-lg shadow-orange-600/40 hover:bg-amber-500 hover:text-stone-900"
          >
            {t.finalCta.ctaPrimary}
          </Link>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-3.5 px-6 py-10 sm:py-14">
      <span className="font-mark bg-gradient-to-br from-amber-500 to-orange-600 bg-clip-text pr-0.5 text-[19px] tracking-tight text-transparent">
        {t.productName}
      </span>
      <span className="text-[13px] font-medium text-stone-400">{t.footer.tagline}</span>
      <div className="flex-1" />
      <span className="text-[13px] font-medium text-stone-400">{t.footer.copyright}</span>
    </footer>
  )
}
