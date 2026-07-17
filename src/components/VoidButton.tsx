import { useState } from 'react'
import { strings } from '../lib/strings'
import { ConfirmDialog } from './ConfirmDialog'

// Reusable void/delete trigger for donations/expenses/handovers. Opens the
// shared ConfirmDialog (a real, focus-trapped modal) instead of the old
// window.prompt — which not only looked unbranded but froze the whole page
// while it was up. The public API is unchanged (onVoid/label/prompt), so the
// four existing call sites kept working; `title`/`body`/`confirmLabel` are
// optional overrides for a screen that wants its own copy.
export function VoidButton({
  onVoid,
  label = strings.void.button,
  prompt = strings.void.prompt,
  title,
  body = strings.void.body,
  confirmLabel,
}: {
  onVoid: (reason: string) => void | Promise<void>
  label?: string
  prompt?: string
  title?: string
  body?: string
  confirmLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleConfirm(reason: string) {
    setBusy(true)
    try {
      // Reason stays optional in the dialog; the audit trail still gets
      // something rather than an empty string. Call sites catch their own
      // errors (they surface them in a banner), so this never rejects.
      await onVoid(reason || strings.void.defaultReason)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50"
      >
        {label}
      </button>
      <ConfirmDialog
        open={open}
        title={title ?? `${label} this entry?`}
        body={body}
        confirmLabel={confirmLabel ?? label}
        cancelLabel={strings.void.cancel}
        reason={{ label: prompt, placeholder: strings.void.reasonPlaceholder }}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
        busy={busy}
      />
    </>
  )
}
