import { useEffect, useRef, useState } from 'react'
import { strings } from '../../lib/strings'
import { formatINR } from '../../lib/money'

type Mode = 'Cash' | 'UPI' | 'Bank'
type Donation = { donor: string; amount: number; mode: Mode }
type FeedItem = Donation & { id: number; no: string }

// Illustrative demo data for the hero mockup — not real donation records.
const DONATIONS: Donation[] = [
  { donor: 'Anjali Kulkarni', amount: 501, mode: 'UPI' },
  { donor: 'Ramesh Patil', amount: 1100, mode: 'Cash' },
  { donor: 'Deshpande family', amount: 2100, mode: 'UPI' },
  { donor: 'Sana Shaikh', amount: 251, mode: 'Cash' },
  { donor: 'Prakash More', amount: 5100, mode: 'Bank' },
  { donor: 'Gauri Joshi', amount: 751, mode: 'UPI' },
  { donor: 'Nikhil Rao', amount: 1001, mode: 'Cash' },
  { donor: 'Fatima Ansari', amount: 301, mode: 'UPI' },
]

const MODE_STYLE: Record<Mode, string> = {
  UPI: 'bg-blue-50 text-blue-700',
  Cash: 'bg-emerald-50 text-emerald-700',
  Bank: 'bg-violet-50 text-violet-700',
}

const DEMO_INTERVAL_MS = 2100

type DemoState = {
  demoIdx: number
  uid: number
  count: number
  feed: FeedItem[]
  total: number
}

const INITIAL_STATE: DemoState = { demoIdx: 0, uid: 0, count: 0, feed: [], total: 0 }

function pushNext(s: DemoState): DemoState {
  const i = s.demoIdx % DONATIONS.length
  const reset = s.demoIdx > 0 && i === 0
  const d = DONATIONS[i]
  const count = (reset ? 0 : s.count) + 1
  const no = 'VYM-' + String(1041 + count).padStart(4, '0')
  const feed = [{ ...d, id: s.uid + 1, no }, ...s.feed].slice(0, 4)
  return { demoIdx: s.demoIdx + 1, uid: s.uid + 1, count, feed, total: (reset ? 0 : s.total) + d.amount }
}

// ponytail: count-up animation drives off a ref (not state) so the rAF loop
// can read the latest value without re-subscribing every frame, and stops
// scheduling once it reaches the target instead of ticking forever.
function useCountUp(target: number) {
  const [display, setDisplay] = useState(0)
  const displayRef = useRef(0)

  useEffect(() => {
    let raf = 0
    const step = () => {
      const cur = displayRef.current
      if (cur === target) return
      const next = Math.abs(target - cur) < 30 ? target : cur + (target - cur) * 0.14
      displayRef.current = next
      setDisplay(next)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])

  return display
}

export function DemoPhone() {
  const t = strings.landing.demoPhone
  const [state, setState] = useState(() => pushNext(INITIAL_STATE))
  const displayTotal = useCountUp(state.total)
  const lastDonation = state.feed[0]

  useEffect(() => {
    const id = setInterval(() => setState((s) => pushNext(s)), DEMO_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="relative flex justify-center">
      <div className="relative w-[300px] rounded-[46px] bg-stone-950 p-2.5 shadow-2xl">
        <div className="flex h-[610px] flex-col overflow-hidden rounded-[37px] bg-stone-50">
          <div className="flex items-center justify-between px-5 pt-3 pb-1 text-xs font-semibold text-stone-800">
            <span>9:41</span>
            <span className="-mt-3 h-5.5 w-23 rounded-b-2xl bg-stone-950" />
            <span className="text-[10px] tracking-widest">●●● ⌁ ▮</span>
          </div>
          <div className="px-4.5 pt-2.5 pb-1.5">
            <div className="mb-3 flex items-center gap-2">
              <div className="font-display flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-[10px] font-extrabold text-stone-900">
                VYM
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-stone-900">{t.mandalName}</div>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" />
                  {t.liveLabel}
                </div>
              </div>
            </div>
            <div className="mb-3 rounded-2xl bg-stone-950 px-4 pt-4 pb-3.5 text-stone-50">
              <div className="text-[10px] font-semibold tracking-wider text-stone-400 uppercase">
                {t.collectedTodayLabel}
              </div>
              <div className="font-display text-3xl leading-tight font-extrabold">
                {formatINR(Math.round(displayTotal) * 100)}
              </div>
              <div className="mt-2 flex gap-3.5">
                <div>
                  <div className="font-display text-sm font-extrabold">{state.count}</div>
                  <div className="text-[9px] font-medium text-stone-400">{t.donorsLabel}</div>
                </div>
                <div className="w-px bg-stone-700" />
                <div>
                  <div className="font-display text-sm font-extrabold text-emerald-400">✓ synced</div>
                  <div className="text-[9px] font-medium text-stone-400">{t.reconciledLabel}</div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-hidden px-4.5">
            <div className="mb-2 text-[10px] font-bold tracking-wider text-amber-700 uppercase">
              {t.recentCollectionsLabel}
            </div>
            {state.feed.map((item) => (
              <div
                key={item.id}
                className="mb-1.5 flex items-center gap-2 rounded-xl border border-stone-200 bg-white p-2"
              >
                <div
                  className={`font-display flex h-7 w-7 flex-none items-center justify-center rounded-lg text-xs font-extrabold ${MODE_STYLE[item.mode]}`}
                >
                  {item.donor[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold text-stone-900">{item.donor}</div>
                  <div className="text-[10px] font-semibold text-stone-500">
                    {item.mode} · {item.no}
                  </div>
                </div>
                <div className="flex-none text-right">
                  <div className="font-display text-sm font-extrabold text-stone-900">
                    +{formatINR(item.amount * 100)}
                  </div>
                  <div className="text-[9px] font-bold text-emerald-600">{t.receiptSentLabel}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {lastDonation && (
          <div
            key={lastDonation.id}
            className="absolute bottom-11 -left-11 z-10 w-[150px] rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-lg"
          >
            <div className="font-mark text-center text-[9px] tracking-wide text-amber-800">{t.mark}</div>
            <div className="my-1 text-center text-[11px] font-bold text-stone-900">{lastDonation.no}</div>
            <div className="text-xs font-bold text-stone-900">{lastDonation.donor}</div>
            <div className="font-display my-0.5 text-xl font-extrabold text-orange-600">
              {formatINR(lastDonation.amount * 100)}
            </div>
            <div className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700">
              {t.sentToDonor}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
