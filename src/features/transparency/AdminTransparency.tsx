import { useEffect, useState } from 'react'
import { getMandal, updateMandal, type Mandal } from '../../lib/db/config'
import {
  getTransparencyReport,
  getTransparencyCategories,
  type TransparencyTotals,
  type CategoryBreakdown,
} from '../../lib/db/transparency'
import { TransparencyReport } from './TransparencyReport'
import { strings } from '../../lib/strings'
import { HowToSheet } from '../admin/HowToSheet'
import { btnRow, btnRowGreen, ctaOrange, eyebrow, infoRound, panel } from '../../components/ui'

const t = strings.transparency

// Admin-only preview + publish toggle content body (rendered inside
// AdminLayout's console frame at /admin/transparency). The preview reuses the
// exact same RPCs the public page calls — the migration's is_admin() bypass
// means an admin always sees the live aggregate here regardless of the publish
// flag, so preview can never drift from what publishing will actually show.
//
// Redesign 2026-08-18: the design's Report tab — one status card carrying the
// published state, who may open it, the link, and the publish action; then the
// preview below under its own label, so "this is exactly what they'll see" is
// literally true of what is on screen.
export function AdminTransparencyContent() {
  // The mandal is fetched before the RPCs rather than alongside them: its slug
  // is what addresses them, so this is a genuine dependency, not an avoidable
  // waterfall.
  const [mandal, setMandal] = useState<Mandal | null>(null)
  const [copied, setCopied] = useState(false)
  const [published, setPublished] = useState(false)
  const [totals, setTotals] = useState<TransparencyTotals | null>(null)
  const [categories, setCategories] = useState<CategoryBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [howToOpen, setHowToOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getMandal()
      .then((m) => {
        if (!active) return
        setMandal(m)
        setPublished(m.transparency_published)
        return Promise.all([getTransparencyReport(m.slug), getTransparencyCategories(m.slug)])
      })
      .then((result) => {
        if (!active || !result) return
        const [report, categoryRows] = result
        setTotals(report)
        setCategories(categoryRows)
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
  }, [])

  async function handleToggle() {
    if (!mandal) return
    setToggling(true)
    setError(null)
    try {
      await updateMandal(mandal.id, { transparency_published: !published })
      setPublished(!published)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setToggling(false)
    }
  }

  const publicUrl = mandal ? `${window.location.origin}/transparency/${mandal.slug}` : ''

  return (
    <>
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className={panel}>
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className={`mt-[5px] h-[9px] w-[9px] flex-none rounded-full ${
              published ? 'bg-green-600 shadow-[0_0_0_3px_rgba(22,163,74,.18)]' : 'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,.18)]'
            }`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-bold text-stone-900">
              {published ? t.publishedTitle : t.notPublishedTitle}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed font-medium text-stone-400 text-pretty">
              {published ? t.publishedBody : t.notPublishedBody}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setHowToOpen(true)}
            aria-label={strings.admin.howToEyebrow}
            className={infoRound}
          >
            i
          </button>
        </div>

        {mandal && (
          <>
            {/* WHO may open it is a Settings decision; WHETHER it is published is
                this tab's. Naming both here is what keeps the two switches from
                being mistaken for one. */}
            <div className="mt-3 flex items-center gap-2 border-t border-stone-100 pt-3">
              <span className="flex-none rounded-full bg-amber-100 px-2.5 py-[3px] text-[10.5px] font-semibold text-amber-800">
                {
                  strings.transparencyVisibility[
                    mandal.transparency_visibility as 'public' | 'members' | 'admins' | 'disabled'
                  ]
                }
              </span>
              <span className="flex-1 text-[11px] font-medium text-stone-400">{t.changeInSettings}</span>
            </div>

            <div className="mt-3 flex items-center gap-2.5 border-t border-stone-100 pt-3">
              <div className="min-w-0 flex-1">
                <p className={eyebrow}>{t.publicLinkLabel}</p>
                <p className="mt-0.5 truncate text-[12.5px] font-medium text-stone-800">{publicUrl}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(publicUrl)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className={copied ? btnRowGreen : btnRow}
              >
                {copied ? t.copied : t.copyLink}
              </button>
            </div>

            {published ? (
              <div className="mt-3.5 flex gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(publicUrl)}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`${btnRowGreen} flex h-[46px] flex-1 items-center justify-center text-[13px]`}
                >
                  {strings.app.shareWhatsApp}
                </a>
                <button
                  type="button"
                  onClick={() => void handleToggle()}
                  disabled={toggling}
                  className={`${btnRow} h-[46px] flex-none px-4 text-[13px]`}
                >
                  {t.unpublishButton}
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleToggle()}
                  disabled={toggling || loading}
                  className={`mt-3.5 ${ctaOrange} h-[48px] text-[14.5px] disabled:opacity-50`}
                >
                  {t.publishCta}
                </button>
                <p className="mt-2 text-center text-[11px] font-medium text-stone-400 text-pretty">{t.publishNote}</p>
              </>
            )}
          </>
        )}
      </div>

      <p className={`${eyebrow} mt-0.5 text-center`}>{t.previewEyebrow}</p>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : totals ? (
        <TransparencyReport totals={totals} categories={categories} mandalName={mandal?.name} />
      ) : (
        // Better an explicit line than a "Preview" label over empty space: the
        // aggregate RPC failing is not the same as a mandal with nothing in it.
        <p className="rounded-[16px] border border-dashed border-stone-300 bg-white px-4 py-10 text-center text-sm text-stone-400">
          {t.reportNotAvailable}
        </p>
      )}

      <HowToSheet tab="report" open={howToOpen} onClose={() => setHowToOpen(false)} />
    </>
  )
}
