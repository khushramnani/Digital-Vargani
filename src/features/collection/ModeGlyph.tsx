import type { DonationMode } from '../../lib/validation/donation'

// The payment-mode marks from the redesign (2026-08-18): drawn with borders and
// bars, not an emoji or an icon font, so they inherit `currentColor` and stay
// crisp at any density. Purely decorative — every tile also carries its text
// label, so nothing here is the only channel for the meaning.

function Cash() {
  return (
    <span className="relative block h-[17px] w-[26px] rounded-[4px] border-[1.6px] border-current">
      <span className="absolute top-1/2 left-1/2 -mt-[3px] -ml-[3px] h-[6px] w-[6px] rounded-full border-[1.6px] border-current" />
    </span>
  )
}

function Upi() {
  return (
    <span className="relative block h-[24px] w-[16px] rounded-[4px] border-[1.6px] border-current">
      <span className="absolute bottom-[2.5px] left-1/2 -ml-[3px] h-[1.6px] w-[6px] rounded-[2px] bg-current" />
    </span>
  )
}

function Bank() {
  return (
    <span className="relative block h-[19px] w-[26px]">
      <span className="absolute top-0 left-1/2 -ml-[11px] h-0 w-0 border-r-[11px] border-b-[7px] border-l-[11px] border-r-transparent border-b-current border-l-transparent" />
      <span className="absolute top-[9px] left-[3px] h-[8px] w-[1.8px] bg-current" />
      <span className="absolute top-[9px] left-1/2 -ml-[0.9px] h-[8px] w-[1.8px] bg-current" />
      <span className="absolute top-[9px] right-[3px] h-[8px] w-[1.8px] bg-current" />
      <span className="absolute bottom-0 left-0 h-[1.8px] w-[26px] rounded-[2px] bg-current" />
    </span>
  )
}

const GLYPHS: Record<DonationMode, () => JSX.Element> = { cash: Cash, upi: Upi, bank: Bank }

export function ModeGlyph({ mode }: { mode: DonationMode }) {
  const Glyph = GLYPHS[mode]
  return (
    <span aria-hidden="true" className="flex h-6 items-center justify-center">
      <Glyph />
    </span>
  )
}
