// Task 10: the offline write-queue's sync logic. Writes land in the Dexie
// `outbox` table first (enqueueDonation, never fails due to network — it's
// a pure local IndexedDB write) and get pushed to the server opportunistically
// (syncOutboxItem/syncAllPending). This is the mechanism behind SPEC.md's
// "no data loss with network off" promise.
import { db, type OutboxDonation } from './db'
import { supabase } from '../db/client'
import {
  createDonation,
  getDonationByIdempotencyKey,
  type CreateDonationInput,
  type Donation,
} from '../db/donations'

function dispatchQueueChanged(): void {
  window.dispatchEvent(new Event('queue:changed'))
}

// The auth user id (not the users.id) of the current session. The outbox is
// device-global; binding rows to the session that queued them is what stops a
// shared phone from syncing one mandal's queued donation into another's books.
async function currentAuthUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

export async function enqueueDonation(input: CreateDonationInput): Promise<{ localId: string }> {
  const localId = crypto.randomUUID()
  await db.outbox.add({
    localId,
    authUserId: (await currentAuthUserId()) ?? '',
    donorName: input.donorName,
    donorPhone: input.donorPhone,
    amountPaise: input.amountPaise,
    mode: input.mode,
    collectedBy: input.collectedBy,
    queuedAt: new Date().toISOString(),
  })
  return { localId }
}

// Fence + PII hygiene on sign-out: the outbox is device-local, so clearing it
// when the session ends stops the next person on a shared phone from seeing
// (or syncing) the previous volunteer's queued donor details.
export async function clearOutbox(): Promise<void> {
  await db.outbox.clear()
}

// The only unique column this insert can ever collide on is
// client_idempotency_key (receipt_no/public_token are always server
// overwritten, and no other column here is unique-constrained) — so a
// 23505 from this specific insert always means "this item already synced".
function isIdempotencyKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505'
}

export async function syncOutboxItem(localId: string): Promise<Donation | null> {
  const item = await db.outbox.get(localId)
  if (!item) return null

  try {
    const donation = await createDonation({
      donorName: item.donorName,
      donorPhone: item.donorPhone,
      amountPaise: item.amountPaise,
      mode: item.mode,
      collectedBy: item.collectedBy,
      clientIdempotencyKey: item.localId,
    })
    await db.outbox.delete(localId)
    dispatchQueueChanged()
    return donation
  } catch (err) {
    if (isIdempotencyKeyViolation(err)) {
      // Recovery, not a failure: the server insert succeeded on a previous
      // attempt but the app didn't get to delete the local row (crash/close
      // between the two). Fetch what the server already has and reconcile.
      const recovered = await getDonationByIdempotencyKey(localId)
      await db.outbox.delete(localId)
      dispatchQueueChanged()
      return recovered
    }
    // Any other error (offline, transient network failure): leave the row
    // queued, let the next sync attempt retry it. Not rethrown — this is a
    // normal, expected outcome for a caller, not an exceptional one.
    return null
  }
}

// Re-entrant guard: a mount-triggered call and an `online`-event-triggered
// call could otherwise overlap and double-sync the same items. In-memory
// only, not persisted or cross-tab — that's all this needs.
let syncInFlight = false

export async function syncAllPending(): Promise<void> {
  // Fast local check first, before touching IndexedDB at all — avoids a
  // burst of guaranteed-to-fail requests (and needless outbox reads) while
  // genuinely offline.
  if (!navigator.onLine) return
  if (syncInFlight) return

  // Set the re-entrancy flag synchronously, before any await, so a second
  // call racing in behind this one sees it and bails.
  syncInFlight = true
  try {
    const authUserId = await currentAuthUserId()
    if (!authUserId) return // no session to attribute a sync to
    const items: OutboxDonation[] = await db.outbox.orderBy('queuedAt').toArray()
    for (const item of items) {
      // Only push the signed-in user's own queued rows. Another session's
      // rows (a different volunteer on a shared device) stay put rather than
      // syncing into THIS mandal's books (audit 2026-07-18 #3).
      if (item.authUserId !== authUserId) continue
      await syncOutboxItem(item.localId)
    }
  } finally {
    syncInFlight = false
  }
}
