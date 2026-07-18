// Task 10's offline write-queue storage. Dexie (IndexedDB) per SPEC.md's
// Tech Stack. A single `outbox` table holds ONLY donations not yet
// confirmed synced to the server — once synced, the row is deleted, since
// the server becomes the source of truth for that donation from then on
// (getPendingSendDonations, Task 8, already covers "synced but SMS not
// sent"). No `status` column: presence in this table means "still pending."
import Dexie, { type EntityTable } from 'dexie'
import type { DonationMode } from '../validation/donation'

export interface OutboxDonation {
  localId: string // crypto.randomUUID(); also doubles as client_idempotency_key on sync
  authUserId: string // session.user.id at enqueue time; sync only pushes the current session's own rows (audit 2026-07-18 #3)
  donorName: string
  donorPhone: string
  amountPaise: number
  mode: DonationMode
  collectedBy: string
  queuedAt: string // ISO timestamp, for display/ordering only
  // Poison-queue tracking (audit 2026-07-18 #6): count of server REJECTIONS
  // (not offline blips), and the last such error. After MAX_SYNC_ATTEMPTS the
  // item is surfaced as "needs attention" instead of retried forever.
  attempts?: number
  failedReason?: string
}

export const db = new Dexie('vinayak-mandal') as Dexie & {
  outbox: EntityTable<OutboxDonation, 'localId'>
}

// authUserId is a plain (non-indexed) property — sync filters it in JS — so
// no schema/version bump is needed for it. Rows queued before this field
// existed carry it as undefined and are treated as belonging to no current
// session (fenced out of sync).
db.version(1).stores({
  outbox: 'localId, queuedAt',
})
