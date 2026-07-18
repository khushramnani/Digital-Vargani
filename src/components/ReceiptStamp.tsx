// The donor receipt's rubber-stamp seal: an ink-oval that reads RECEIVED over
// the mode (CASH / ONLINE) over the mandal's name, rotated and slightly faded
// like a real stamp pressed onto paper. Red ink for cash, green for online —
// the same cash-vs-electronic convention the app uses everywhere. `label` is
// the accessible name (e.g. "RECEIVED: CASH"); the visible English wording is
// the stamp's own lettering.
export function ReceiptStamp({
  label,
  mode,
  mandalName,
}: {
  label: string
  mode: 'cash' | 'online'
  mandalName: string
}) {
  const ink = mode === 'cash' ? '#a8382a' : '#4f7a48'
  return (
    <div
      role="img"
      aria-label={label}
      className="relative flex h-[92px] w-[122px] shrink-0 -rotate-[9deg] select-none flex-col items-center justify-center rounded-[50%] text-center opacity-85"
      style={{ color: ink, border: `2px solid ${ink}`, boxShadow: `inset 0 0 0 2.5px ${ink}` }}
    >
      <span className="text-[8px] font-bold tracking-[0.35em] uppercase">Received</span>
      <span className="text-[19px] leading-none font-black tracking-wide uppercase">
        {mode === 'cash' ? 'Cash' : 'Online'}
      </span>
      <span className="mt-1 max-w-[86%] truncate text-[6.5px] font-semibold tracking-[0.15em] uppercase">
        {mandalName}
      </span>
    </div>
  )
}
