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
  donorName: string
  donorPhone: string
  amountPaise: number
  mode: DonationMode
  collectedBy: string
  queuedAt: string // ISO timestamp, for display/ordering only
}

export const db = new Dexie('vinayak-mandal') as Dexie & {
  outbox: EntityTable<OutboxDonation, 'localId'>
}

db.version(1).stores({
  outbox: 'localId, queuedAt',
})
