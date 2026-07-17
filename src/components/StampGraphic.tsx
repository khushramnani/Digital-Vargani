// Reusable CSS-only "rubber stamp" visual — no image asset, no SVG
// pipeline. Rotated double-border box in a stamp-ink color; red reads as
// "cash in hand", blue as "moved electronically", a simple, common
// convention for either variant this app needs.
export type StampVariant = 'cash' | 'online' | 'approved'

const VARIANT_STYLES: Record<StampVariant, string> = {
  cash: 'border-red-700 text-red-700',
  online: 'border-blue-700 text-blue-700',
  approved: 'border-emerald-700 text-emerald-700',
}

export function StampGraphic({ label, variant }: { label: string; variant: StampVariant }) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`inline-flex -rotate-6 select-none items-center justify-center rounded-lg border-4 border-double px-6 py-3 opacity-80 ${VARIANT_STYLES[variant]}`}
    >
      <span className="text-xl font-black tracking-widest uppercase">{label}</span>
    </div>
  )
}
