import { strings } from '../../lib/strings'
import { Sheet } from '../../components/Sheet'
import { closeRound, ctaQuiet, eyebrow } from '../../components/ui'

const a = strings.admin

export type HowToTab = keyof typeof a.howTo

// The round "i" on each tab's hero opens this: what the tab is FOR, in the
// treasurer's own terms. Three notes per tab, copy verbatim from the design.
// One component rather than six, because the shape is identical and only the
// notes differ — the tab key picks them.
export function HowToSheet({ tab, open, onClose }: { tab: HowToTab; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="howto-sheet-title">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <p className={eyebrow}>{a.howToEyebrow}</p>
          <h2
            id="howto-sheet-title"
            className="font-display mt-0.5 text-[19px] font-extrabold tracking-[-0.02em] text-stone-900"
          >
            {a.titles[tab]}
          </h2>
        </div>
        <button type="button" onClick={onClose} aria-label={strings.app.close} className={closeRound}>
          ✕
        </button>
      </div>

      <div className="mt-[18px] flex flex-col gap-3.5">
        {a.howTo[tab].map((note) => (
          <div key={note.title}>
            <h3 className="text-[13px] font-bold text-stone-900">{note.title}</h3>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-stone-600 text-pretty">{note.body}</p>
          </div>
        ))}
      </div>

      <button type="button" onClick={onClose} className={`mt-5 ${ctaQuiet}`}>
        {strings.app.gotIt}
      </button>
    </Sheet>
  )
}
