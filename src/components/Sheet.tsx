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
      className="fixed inset-0 m-0 flex h-full max-h-none w-full max-w-none items-end justify-center bg-transparent p-0 backdrop:bg-stone-900/50 backdrop:backdrop-blur-sm"
    >
      <div
        className={`max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-300 ease-out will-change-transform ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {children}
      </div>
    </dialog>
  )
}
