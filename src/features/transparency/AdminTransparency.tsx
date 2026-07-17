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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-stone-900">{t.title}</h1>
        <button
          type="button"
          onClick={handleToggle}
          disabled={toggling || loading}
          className={`rounded px-3 py-2 text-sm font-medium disabled:opacity-50 ${
            published ? 'border border-stone-300 text-stone-700' : 'bg-orange-700 text-white'
          }`}
        >
          {published ? t.unpublishButton : t.publishButton}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <p className="text-sm text-stone-500">{published ? t.publishedStatus : t.unpublishedStatus}</p>

      {/* The slug's whole purpose is a link pasted into a WhatsApp group —
          without a visible copy affordance it's a column nobody uses. */}
      {mandal && (
        <div className="flex items-center gap-2 rounded border border-stone-200 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-stone-500">{t.publicLinkLabel}</p>
            <p className="truncate text-sm text-stone-800">{`${window.location.origin}/transparency/${mandal.slug}`}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(`${window.location.origin}/transparency/${mandal.slug}`)
              setCopied(true)
            }}
            className="flex-none rounded border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700"
          >
            {copied ? t.copied : t.copyLink}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : (
        totals && <TransparencyReport totals={totals} categories={categories} mandalName={mandal?.name} />
      )}
    </main>
  )
}
