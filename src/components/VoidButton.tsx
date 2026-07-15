import { strings } from '../lib/strings'

// Reusable void trigger for donations/expenses/handovers. A native
// window.prompt for the required reason, not a polished dialog — same
// intentionally-minimal choice Tasks 11/12 each made ad hoc; this just
// gives them (and Task 15+) one shared implementation instead of three
// copies. `label`/`prompt` let call sites keep their existing entity-
// specific copy (e.g. "Reason for voiding this expense:") while defaulting
// to something generic.
export function VoidButton({
  onVoid,
  label = strings.void.button,
  prompt = strings.void.prompt,
}: {
  onVoid: (reason: string) => void | Promise<void>
  label?: string
  prompt?: string
}) {
  function handleClick() {
    const reason = window.prompt(prompt)
    if (!reason?.trim()) return
    onVoid(reason.trim())
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-2 rounded border border-red-700 px-2 py-1 text-sm text-red-700"
    >
      {label}
    </button>
  )
}
