import { useEffect, useId, useRef, useState } from 'react'

// One confirm dialog for every destructive action in the app — replaces the
// blocking window.prompt the void flow used to open (a native JS prompt also
// freezes the whole page). Built on the native <dialog> element for its free
// focus trap, Escape handling and inert backdrop, so there's no a11y wiring
// or dependency to own.
//
// Two optional add-ons cover both callers:
//   • reason   — a textarea whose value is handed to onConfirm (delete keeps
//                a "why" for the audit trail; it's optional, defaulted).
//   • requirePhrase — the guard for a bulk wipe: confirm stays disabled until
//                the exact phrase is typed.
//
// Rendered only while `open`, so a closed dialog leaves nothing in the DOM
// (no stray confirm button shadowing the trigger). showModal()/close() are
// the only way to get the modal backdrop + focus trap; where they're missing
// (jsdom) it falls back to the plain `open` attribute so tests still work.
type DialogProps = {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  // Receives the (trimmed) reason text, or '' when no reason field is shown.
  onConfirm: (reason: string) => void
  onCancel: () => void
  reason?: { label: string; placeholder?: string }
  requirePhrase?: { label: string; phrase: string }
  busy?: boolean
}

// Mounting only while open keeps a closed dialog out of the DOM entirely, and
// lets DialogBody hold the field state — so it resets on every fresh open
// (new mount) without a setState-in-effect.
export function ConfirmDialog({ open, ...props }: DialogProps & { open: boolean }) {
  if (!open) return null
  return <DialogBody {...props} />
}

function DialogBody({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  reason,
  requirePhrase,
  busy = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [reasonText, setReasonText] = useState('')
  const [phraseText, setPhraseText] = useState('')
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    const el = ref.current
    // `!el.open` guards StrictMode's double effect invocation — showModal()
    // on an already-open dialog throws. Falls back to the `open` attribute
    // where showModal is unavailable (jsdom).
    if (el && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
    }
  }, [])

  const phraseOk = !requirePhrase || phraseText.trim() === requirePhrase.phrase
  const canConfirm = phraseOk && !busy

  function cancel() {
    if (!busy) onCancel()
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      // Escape fires `cancel`; take it over so closing always routes through
      // our handler (and can be blocked mid-request), never the browser's.
      onCancel={(e) => {
        e.preventDefault()
        cancel()
      }}
      // Clicks land on the <dialog> itself only when they hit the backdrop.
      onClick={(e) => {
        if (e.target === ref.current) cancel()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-2xl backdrop:bg-stone-900/60 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-red-100 text-xl text-red-600">
            ⚠
          </div>
          <div className="flex-1 pt-0.5">
            <h2 id={titleId} className="font-display text-lg font-bold tracking-tight text-stone-900">
              {title}
            </h2>
            <p id={bodyId} className="mt-1 text-[15px] leading-relaxed text-stone-600">
              {body}
            </p>
          </div>
        </div>

        {reason && (
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-stone-600">
            {reason.label}
            <textarea
              autoFocus
              rows={2}
              value={reasonText}
              placeholder={reason.placeholder}
              onChange={(e) => setReasonText(e.target.value)}
              className="resize-none rounded-xl border border-stone-300 px-3 py-2 text-[15px] font-normal text-stone-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
            />
          </label>
        )}

        {requirePhrase && (
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-stone-600">
            {requirePhrase.label}
            <input
              value={phraseText}
              onChange={(e) => setPhraseText(e.target.value)}
              autoComplete="off"
              className="rounded-xl border border-stone-300 px-3 py-2 font-mono text-[15px] font-normal tracking-wide text-stone-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
            />
          </label>
        )}

        <div className="mt-1 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="rounded-xl px-4 py-2.5 text-sm font-bold text-stone-600 hover:bg-stone-100 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reasonText.trim())}
            disabled={!canConfirm}
            className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm shadow-red-600/30 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
