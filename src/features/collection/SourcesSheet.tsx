import { useState } from 'react'
import { addDonationSource, updateMandal } from '../../lib/db/config'
import {
  MAX_SOURCES,
  MAX_SOURCE_NAME_LENGTH,
  canAddSource,
  validateSourceName,
  type SourceNameError,
} from '../../lib/sources'
import { strings } from '../../lib/strings'
import { Sheet } from '../../components/Sheet'
import { SheetHeader } from '../../components/console'
import { ctaOrange, ctaQuiet, ctaMuted, consoleField, errorText } from '../../components/ui'

const t = strings.sources

// The design's `sources` sheet. Who may do what is the decided open question 1
// (user, 2026-08-18): a VOLUNTEER may add — they're the one standing at a shop
// that fits none of the existing names — while rename and remove stay admin-only.
// Those are two genuinely different write paths, not one gated UI:
//   · add    → add_donation_source() RPC, granted to authenticated
//   · rename → updateMandal({ donation_sources }), admin-only RLS
//   · remove →            ditto
// so a volunteer's sheet simply has no rename/remove controls to disable.
//
// Renaming or removing NEVER rewrites a donation: past rows keep the name they
// were logged under (lib/sources.ts). That promise is the sheet's own hint copy.
type Props = {
  open: boolean
  onClose: () => void
  sources: string[]
  // Only an admin has one (getMandal is admin-only), and only rename/remove
  // need it — a volunteer's add goes through the RPC, which resolves the mandal
  // from the session.
  mandalId: string | null
  canEdit: boolean
  onChange: (sources: string[]) => void
}

// Sheet renders nothing while closed, so the body below mounts fresh on every
// open — which is the whole draft-reset mechanism. No re-seeding effect, and in
// particular nothing that could wipe the "saved" note the moment the parent's
// `sources` prop changes in response to the very save that set it.
export function SourcesSheet(props: Props) {
  return (
    <Sheet open={props.open} onClose={props.onClose} labelledBy="sources-sheet-title">
      <SourcesSheetBody {...props} />
    </Sheet>
  )
}

function SourcesSheetBody({ onClose, sources, mandalId, canEdit, onChange }: Props) {
  // The admin's edits are a draft until Save, matching how Mandal settings
  // behaves — one write for a rename plus a removal, not one per keystroke.
  const [draft, setDraft] = useState<string[]>(sources)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty = canEdit && (draft.length !== sources.length || draft.some((s, i) => s !== sources[i]))

  function fail(code: SourceNameError) {
    setError(t.errors[code])
  }

  // An admin's add is a draft edit like any other; a volunteer's goes straight
  // to the RPC, since they have no Save button to press.
  async function handleAdd() {
    setError(null)
    const list = canEdit ? draft : sources
    const result = validateSourceName(newName, list, { checkCap: true })
    if (!result.ok) return fail(result.error)

    if (canEdit) {
      setDraft([...draft, result.name])
      setNewName('')
      return
    }
    setBusy(true)
    try {
      onChange(await addDonationSource(result.name))
      setNewName('')
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!dirty || !mandalId) return
    setError(null)
    // Validate the whole draft, not just the last edit: a rename can empty a
    // field or collide with another row, and the DB would take either.
    const cleaned: string[] = []
    for (const [i, raw] of draft.entries()) {
      const result = validateSourceName(raw, draft.filter((_, n) => n !== i))
      if (!result.ok) return fail(result.error)
      cleaned.push(result.name)
    }
    setBusy(true)
    try {
      await updateMandal(mandalId, { donation_sources: cleaned })
      onChange(cleaned)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const list = canEdit ? draft : sources
  const full = !canAddSource(list)

  return (
    <>
      <SheetHeader
        title={t.sheetTitle}
        titleId="sources-sheet-title"
        hint={canEdit ? t.sheetHint : t.volunteerHint}
        onClose={onClose}
        closeLabel={strings.app.close}
      />

      <div className="mt-4 flex flex-col gap-2">
        {list.map((name, i) =>
          canEdit ? (
            <div key={i} className="flex gap-2">
              <input
                value={name}
                aria-label={`${t.rename} ${i + 1}`}
                maxLength={MAX_SOURCE_NAME_LENGTH}
                onChange={(e) =>
                  setDraft((current) => current.map((s, n) => (n === i ? e.target.value : s)))
                }
                className={`${consoleField} h-[44px] flex-1 font-semibold`}
              />
              <button
                type="button"
                aria-label={`${t.remove}: ${name}`}
                onClick={() => setDraft((current) => current.filter((_, n) => n !== i))}
                className="h-[44px] w-[44px] flex-none rounded-xl border border-stone-200 bg-white text-sm font-semibold text-stone-400 transition-colors hover:border-red-200 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          ) : (
            <div
              key={i}
              className="flex h-[44px] items-center rounded-xl border border-hairline bg-stone-50 px-3 text-[13.5px] font-semibold text-stone-700"
            >
              {name}
            </div>
          ),
        )}
      </div>

      {full && <p className="mt-2 text-[11px] leading-relaxed text-stone-400">{t.capHint}</p>}

      {!full && (
        <div className="mt-3 flex gap-2">
          <input
            value={newName}
            aria-label={t.addPlaceholder}
            placeholder={t.addPlaceholder}
            maxLength={MAX_SOURCE_NAME_LENGTH}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleAdd()
              }
            }}
            className={`${consoleField} h-[44px] flex-1 border-dashed border-stone-300 font-semibold`}
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={busy}
            className="h-[44px] flex-none rounded-xl bg-stone-900 px-4 text-[12.5px] font-bold text-white transition-colors hover:bg-stone-800 disabled:opacity-50"
          >
            {strings.app.add}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className={`mt-2 ${errorText}`}>
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="mt-2 text-sm font-semibold text-green-700">
          {t.saved}
        </p>
      )}

      {canEdit ? (
        <button
          type="button"
          onClick={dirty ? () => void handleSave() : onClose}
          disabled={busy}
          className={`mt-4 ${dirty ? ctaOrange : ctaQuiet}`}
        >
          {busy ? t.saving : dirty ? t.saveButton : strings.app.done}
        </button>
      ) : (
        <button type="button" onClick={onClose} disabled={busy} className={`mt-4 ${busy ? ctaMuted : ctaQuiet}`}>
          {strings.app.done}
        </button>
      )}
      {/* The cap is stated once here rather than on every rejected add. */}
      <p className="mt-2 text-center text-[11px] text-stone-400">
        {list.length}/{MAX_SOURCES}
      </p>
    </>
  )
}
