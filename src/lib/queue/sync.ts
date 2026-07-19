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

// How many server rejections an outbox item tolerates before it's treated as
// poison and surfaced for manual attention instead of retried forever.
export const MAX_SYNC_ATTEMPTS = 3

function dispatchQueueChanged(): void {
  window.dispatchEvent(new Event('queue:changed'))
}

// A PERMANENT rejection: the payload or the caller's permissions are wrong, so
// every retry fails identically — a constraint/FK/check/not-null violation
// (SQLSTATE class 23), an RLS/privilege/undefined-object error (class 42), or a
// data exception (class 22). Transient coded errors — connection (08),
// too-many-connections (53), statement timeout (57014), serialization/deadlock
// (40) — and errors with no code (offline/network) are NOT poison: they're left
// queued to retry once the server recovers (audit review 2026-07-18).
function isPermanentRejection(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string' || code.length < 2) return false
  const cls = code.slice(0, 2)
  return cls === '22' || cls === '23' || cls === '42'
}

function errorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
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
    // Enqueue only ever runs from the collection form, i.e. with a signed-in
    // volunteer, so this resolves to their real auth id. The '' fallback is the
    // "untagged" sentinel for the (practically unreachable) session-less case —
    // it is NOT fenced by session (see syncAllPending), so it syncs under
    // whoever is signed in; the composite actor FK is what still stops it
    // landing in another mandal's books.
    authUserId: (await currentAuthUserId()) ?? '',
    donorName: input.donorName,
    donorPhone: input.donorPhone,
    amountPaise: input.amountPaise,
    mode: input.mode,
    category: input.category,
    collectedBy: input.collectedBy,
    queuedAt: new Date().toISOString(),
  })
  return { localId }
}

// NOTE: we deliberately do NOT clear the outbox on sign-out. Every outbox row
// is a collected-but-unsynced donation; wiping them on SIGNED_OUT silently
// destroyed money records (a volunteer signing out — or re-opening their invite
// link, which signs out first — while offline lost everything queued), breaking
// the "no data loss with network off" guarantee. Cross-mandal safety instead
// comes from the composite actor FKs (a row can't sync into another tenant's
// books) plus the authUserId fence in syncAllPending below; donor PII in
// IndexedDB is never shown to the next user, since PendingSend filters the tray
// by collectedBy. No-data-loss wins over PII-scrub for a money ledger.

// Manual discard of a poison item the volunteer chooses to give up on
// (audit #6). Dispatches queue:changed so the tray drops it immediately.
export async function discardOutboxItem(localId: string): Promise<void> {
  await db.outbox.delete(localId)
  dispatchQueueChanged()
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
      // Legacy outbox rows (queued before v4) carry no category — default to
      // 'society', matching the DB column's default.
      category: item.category ?? 'society',
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
    // A PERMANENT server rejection (audit #6): record the failure so it stops
    // being an invisible "waiting for signal" forever. After MAX_SYNC_ATTEMPTS
    // the UI flags it for attention and syncAllPending skips it. A transient
    // error falls through to the retry path below.
    if (isPermanentRejection(err)) {
      await db.outbox.update(localId, {
        attempts: (item.attempts ?? 0) + 1,
        failedReason: errorMessage(err),
      })
      dispatchQueueChanged()
      return null
    }
    // Otherwise (offline, transient network failure): leave the row queued,
    // untouched, and let the next sync attempt retry it. Not rethrown — this
    // is a normal, expected outcome for a caller, not an exceptional one.
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
      // Only fence out rows explicitly tagged for a DIFFERENT session (a
      // different volunteer on a shared device) — audit 2026-07-18 #3. A row
      // with no authUserId predates that field (queued on an older build by
      // this same, still-signed-in user), so sync it rather than stranding it
      // forever (audit review 2026-07-18).
      if (item.authUserId && item.authUserId !== authUserId) continue
      // Skip poison items — they've failed on the server MAX_SYNC_ATTEMPTS
      // times and won't succeed on retry; the UI surfaces them instead.
      if ((item.attempts ?? 0) >= MAX_SYNC_ATTEMPTS) continue
      await syncOutboxItem(item.localId)
    }
  } finally {
    syncInFlight = false
  }
}
