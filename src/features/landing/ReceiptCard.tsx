import { StampGraphic } from '../../components/StampGraphic'
import { formatINR } from '../../lib/money'

// Mock receipt visual for the landing page's product-demo sections
// (transparency sample, multilingual preview) — not the real receipt
// renderer, see features/receipt/ReceiptPage.tsx for that.
export function ReceiptCard({
  mark,
  mandalName,
  subtitle,
  noLabel,
  donorLabel,
  amountLabel,
  receiptNo,
  donorName,
  amountRupees,
  thanks,
  showStamp = false,
}: {
  mark: string
  mandalName: string
  subtitle: string
  noLabel: string
  donorLabel: string
  amountLabel: string
  receiptNo: string
  donorName: string
  amountRupees: number
  thanks: string
  showStamp?: boolean
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-xl">
      <div className="mb-3 border-b border-dashed border-amber-300 pb-3 text-center">
        <div className="font-mark text-xs tracking-wide text-amber-800">{mark}</div>
        <div className="font-display mt-1 text-lg font-bold text-stone-900">{mandalName}</div>
        <div className="text-xs font-medium text-stone-400">{subtitle}</div>
      </div>
      <div className="mb-2 flex justify-between text-sm font-medium text-stone-700">
        <span>{noLabel}</span>
        <span className="font-bold">{receiptNo}</span>
      </div>
      <div className="mb-3 flex justify-between text-sm font-medium text-stone-700">
        <span>{donorLabel}</span>
        <span className="font-bold">{donorName}</span>
      </div>
      <div className="mb-3 flex items-baseline justify-between text-sm font-medium text-stone-700">
        <span>{amountLabel}</span>
        <span className="font-display text-2xl font-extrabold text-orange-600">{formatINR(amountRupees * 100)}</span>
      </div>
      <div className="rounded-lg bg-stone-100 p-3 text-center text-xs leading-relaxed text-stone-600">{thanks}</div>
      {showStamp && (
        <div className="absolute right-3 bottom-3">
          <StampGraphic label="PAID" variant="approved" />
        </div>
      )}
    </div>
  )
}
