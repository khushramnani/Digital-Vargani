import { useEffect, useRef, useState, type ReactNode } from 'react'

// A generic bottom action sheet: slides up over a dimmed backdrop, focus
// trapped, Esc / backdrop-tap = onClose, focus returns to the opener. Built on
// the native <dialog> element (same pattern as ConfirmDialog) so the focus
// trap, ::backdrop and top-layer stacking are free — no a11y wiring to own.
// Reused by the collect flow's post-submit send step and a future "More" menu.

export function Sheet({
  open,
  onClose,
  children,
  labelledBy,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  labelledBy?: string
}) {
  // Unmount when closed → nothing lingers in the DOM (no exit animation, which
  // the closed-state contract explicitly allows). ponytail: enter-only slide;
  // add an exit transition only if the dismiss ever looks abrupt in practice.
  if (!open) return null
  return (
    <SheetBody onClose={onClose} labelledBy={labelledBy}>
      {children}
    </SheetBody>
  )
}

function SheetBody({
  onClose,
  children,
  labelledBy,
}: {
  onClose: () => void
  children: ReactNode
  labelledBy?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    // Capture the opener BEFORE showModal() steals focus, so we can hand focus
    // back on unmount (native close() would do this, but we unmount instead).
    const opener = document.activeElement as HTMLElement | null
    if (el && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '') // jsdom fallback
    }
    const raf = requestAnimationFrame(() => setShown(true)) // next frame → slide up
    return () => {
      cancelAnimationFrame(raf)
      opener?.focus?.()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault() // route Escape through our handler
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose() // backdrop / dim-area tap
      }}
      className="fixed inset-0 m-0 flex h-full max-h-none w-full max-w-none items-end justify-center bg-transparent p-0 backdrop:animate-dim-in backdrop:bg-stone-900/50 backdrop:backdrop-blur-sm"
    >
      {/* The panel owns the padding so every caller gets it for free (content
          was rendering flush to both screen edges). The bottom pad ADDS to the
          safe-area inset rather than relying on it — on a phone without one it
          was zero, leaving the last row against the nav bar.
          Redesign (2026-08-18): 22px top radius, 18px gutters, and the
          scrollbar hidden — a sheet that scrolls internally must not grow a
          rail down the middle of a 360px screen. */}
      <div
        className={`max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[22px] bg-white px-[18px] pt-2.5 pb-[calc(1.625rem+env(safe-area-inset-bottom))] shadow-2xl transition-transform duration-300 [scrollbar-width:none] ease-[cubic-bezier(0.22,0.75,0.2,1)] will-change-transform [&::-webkit-scrollbar]:hidden ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Grab handle: the standard bottom-sheet affordance, and it gives the
            content breathing room off the rounded top edge. */}
        <div aria-hidden="true" className="mx-auto mb-3.5 h-1 w-[38px] rounded-full bg-stone-300" />
        {children}
      </div>
    </dialog>
  )
}
