// Task 10's offline write-queue storage. Dexie (IndexedDB) per SPEC.md's
// Tech Stack. A single `outbox` table holds ONLY donations not yet
// confirmed synced to the server — once synced, the row is deleted, since
// the server becomes the source of truth for that donation from then on
// (getPendingSendDonations, Task 8, already covers "synced but SMS not
// sent"). No `status` column: presence in this table means "still pending."
import Dexie, { type EntityTable } from 'dexie'
import type { DonationMode } from '../validation/donation'
import type { DonationCategory } from '../db/donations'

export interface OutboxDonation {
  localId: string // crypto.randomUUID(); also doubles as client_idempotency_key on sync
  authUserId: string // session.user.id at enqueue time; sync only pushes the current session's own rows (audit 2026-07-18 #3)
  donorName: string
  donorPhone: string
  amountPaise: number
  mode: DonationMode
  // v4 (§2): donation source category. Like authUserId, a plain (non-indexed)
  // property — sync reads it in JS — so no schema/version bump is needed. Rows
  // queued before this field existed carry it as undefined; sync defaults them
  // to 'society' (the DB column's own default) rather than stranding them.
  category: DonationCategory
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
// existed carry it as undefined (and a session-less enqueue stores ''); sync
// treats an undefined/empty tag as "not bound to any specific session" and
// pushes it under the CURRENT session rather than stranding it forever — only
// a row tagged for a DIFFERENT session is fenced out (see syncAllPending).
// Cross-mandal safety comes from the composite actor FKs, not from this tag.
db.version(1).stores({
  outbox: 'localId, queuedAt',
})
