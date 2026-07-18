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
import { AppShell } from '../../components/AppShell'
import { card, btnPrimary, btnGhost, errorText } from '../../components/ui'

const t = strings.transparency

// Admin-only preview + publish toggle (routed at /admin/transparency). The
// preview reuses the exact same RPCs the public page calls — the
// migration's is_admin() bypass means an admin always sees the live
// aggregate here regardless of the publish flag, so preview can never
// drift from what publishing will actually show.
export function AdminTransparency() {
  // The mandal is fetched before the RPCs rather than alongside them: its
  // slug is what addresses them, so this is a genuine dependency, not an
  // avoidable waterfall.
  const [mandal, setMandal] = useState<Mandal | null>(null)
  const [copied, setCopied] = useState(false)
  const [published, setPublished] = useState(false)
  const [totals, setTotals] = useState<TransparencyTotals | null>(null)
  const [categories, setCategories] = useState<CategoryBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
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
    <AppShell
      title={t.title}
      back={{ to: '/admin', label: strings.admin.dashboardTitle }}
      actions={
        <button
          type="button"
          onClick={handleToggle}
          disabled={toggling || loading}
          className={published ? btnGhost : btnPrimary}
        >
          {published ? t.unpublishButton : t.publishButton}
        </button>
      }
    >
      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}

      {/* Status + shareable link. The slug's whole purpose is a link pasted
          into a WhatsApp group — without a visible copy affordance it's a
          column nobody uses. */}
      <div className={`flex flex-col gap-3 ${card} p-4`}>
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 flex-none rounded-full ${published ? 'bg-green-500' : 'bg-amber-500'}`}
            aria-hidden
          />
          <p className="text-sm font-medium text-stone-600">{published ? t.publishedStatus : t.unpublishedStatus}</p>
        </div>
        {mandal && (
          <div className="flex items-center gap-2 border-t border-stone-100 pt-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-wide text-stone-400 uppercase">{t.publicLinkLabel}</p>
              <p className="truncate text-sm text-stone-800">{publicUrl}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(publicUrl)
                setCopied(true)
              }}
              className={`flex-none ${btnGhost} px-3 py-1.5`}
            >
              {copied ? t.copied : t.copyLink}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : (
        totals && <TransparencyReport totals={totals} categories={categories} mandalName={mandal?.name} />
      )}
    </AppShell>
  )
}
