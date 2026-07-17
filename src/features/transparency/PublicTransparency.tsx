import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getTransparencyReport,
  getTransparencyCategories,
  type TransparencyTotals,
  type CategoryBreakdown,
} from '../../lib/db/transparency'
import { TransparencyReport } from './TransparencyReport'
import { strings } from '../../lib/strings'

const t = strings.transparency

// Public, unauthenticated route (/transparency/:slug) — no RequireRole
// guard, same as ReceiptPage. The slug is what picks the mandal; both RPCs
// already return zero rows when that mandal's transparency_published is
// false, so "not published yet" is enforced server-side, not by hiding an
// already-fetched payload. An unknown slug returns zero rows too, and so
// renders identically to an unpublished report — deliberate: the page must
// not leak which slugs exist.
export function PublicTransparency() {
  const { slug } = useParams<{ slug: string }>()
  const [totals, setTotals] = useState<TransparencyTotals | null>(null)
  const [categories, setCategories] = useState<CategoryBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let active = true
    Promise.all([getTransparencyReport(slug), getTransparencyCategories(slug)])
      .then(([report, categoryRows]) => {
        if (!active) return
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
  }, [slug])

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 bg-stone-50 px-4 py-8 sm:py-12">
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : totals ? (
        <TransparencyReport totals={totals} categories={categories} mandalName={totals.mandalName} />
      ) : (
        <p className="text-stone-400">{t.notPublished}</p>
      )}
    </main>
  )
}
