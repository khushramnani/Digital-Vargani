import { useEffect, useState } from 'react'
import {
  getTransparencyReport,
  getTransparencyCategories,
  type TransparencyTotals,
  type CategoryBreakdown,
} from '../../lib/db/transparency'
import { TransparencyReport } from './TransparencyReport'
import { strings } from '../../lib/strings'

const t = strings.transparency

// Public, unauthenticated route (/transparency) — no RequireRole guard,
// same as ReceiptPage. get_transparency_report/get_transparency_categories
// (Task 16 migration) already return zero rows when
// mandal_config.transparency_published is false, so "not published yet" is
// enforced server-side, not by hiding an already-fetched payload.
export function PublicTransparency() {
  const [totals, setTotals] = useState<TransparencyTotals | null>(null)
  const [categories, setCategories] = useState<CategoryBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([getTransparencyReport(), getTransparencyCategories()])
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
  }, [])

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold text-stone-900">{t.title}</h1>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : totals ? (
        <TransparencyReport totals={totals} categories={categories} />
      ) : (
        <p className="text-stone-400">{t.notPublished}</p>
      )}
    </main>
  )
}
