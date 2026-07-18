import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Tables } from '../src/lib/db/database.types'
import type { CreateDonationInput } from '../src/lib/db/donations'
import { enqueueDonation, syncOutboxItem, syncAllPending, MAX_SYNC_ATTEMPTS } from '../src/lib/queue/sync'

// Mock src/lib/db/donations.ts, same shape as tests/CollectionForm.test.tsx.
const { createDonation, getDonationByIdempotencyKey } = vi.hoisted(() => ({
  createDonation: vi.fn(),
  getDonationByIdempotencyKey: vi.fn(),
}))

vi.mock('../src/lib/db/donations', () => ({
  createDonation,
  getDonationByIdempotencyKey,
}))

// enqueue stamps each row with the current session's auth user id, and sync
// only pushes rows matching the current session (audit 2026-07-18 #3), so the
// auth client is now part of the queue's dependencies.
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../src/lib/db/client', () => ({
  supabase: { auth: { getSession } },
}))

// Fake in-memory stand-in for the Dexie `outbox` table — jsdom doesn't
// implement IndexedDB, so this mocks the Dexie layer the same way this
// repo's other tests mock the Supabase client: exactly what the module
// under test calls, not real browser storage.
const { outbox, outboxRows } = vi.hoisted(() => {
  const outboxRows = new Map<string, Record<string, unknown>>()
  const outbox = {
    add: vi.fn((row: { localId: string } & Record<string, unknown>) => {
      outboxRows.set(row.localId, row)
      return Promise.resolve(row.localId)
    }),
    get: vi.fn((localId: string) => Promise.resolve(outboxRows.get(localId))),
    delete: vi.fn((localId: string) => {
      outboxRows.delete(localId)
      return Promise.resolve()
    }),
    update: vi.fn((localId: string, changes: Record<string, unknown>) => {
      const row = outboxRows.get(localId)
      if (row) outboxRows.set(localId, { ...row, ...changes })
      return Promise.resolve(row ? 1 : 0)
    }),
    orderBy: vi.fn(() => ({
      toArray: () =>
        Promise.resolve(
          Array.from(outboxRows.values()).sort((a, b) =>
            String(a.queuedAt).localeCompare(String(b.queuedAt)),
          ),
        ),
    })),
  }
  return { outbox, outboxRows }
})

vi.mock('../src/lib/queue/db', () => ({ db: { outbox } }))

const donationInput: CreateDonationInput = {
  donorName: 'Ramesh Kulkarni',
  donorPhone: '9876543210',
  amountPaise: 50100,
  mode: 'cash',
  collectedBy: 'volunteer-1',
}

const serverDonation: Tables<'donations'> = {
  id: 'donation-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  receipt_no: 42,
  public_token: 'tok-abc',
  donor_name: 'Ramesh Kulkarni',
  donor_phone: '9876543210',
  amount_paise: 50100,
  mode: 'cash',
  collected_by: 'volunteer-1',
  created_at: '2026-01-01T00:00:00Z',
  voided: false,
  void_reason: null,
  voided_by: null,
  voided_at: null,
  sms_sent_at: null,
  client_idempotency_key: 'some-local-id',
}

function captureQueueChanged() {
  const spy = vi.fn()
  window.addEventListener('queue:changed', spy)
  return spy
}

beforeEach(() => {
  vi.clearAllMocks()
  outboxRows.clear()
  getSession.mockResolvedValue({ data: { session: { user: { id: 'auth-user-1' } } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('enqueueDonation', () => {
  it('writes to the outbox and returns a localId immediately — never touches the network', async () => {
    const { localId } = await enqueueDonation(donationInput)

    expect(typeof localId).toBe('string')
    expect(localId.length).toBeGreaterThan(0)
    expect(createDonation).not.toHaveBeenCalled()
    const stored = await outbox.get(localId)
    expect(stored).toEqual({
      localId,
      authUserId: 'auth-user-1',
      donorName: donationInput.donorName,
      donorPhone: donationInput.donorPhone,
      amountPaise: donationInput.amountPaise,
      mode: donationInput.mode,
      collectedBy: donationInput.collectedBy,
      queuedAt: expect.any(String),
    })
  })
})

describe('syncOutboxItem', () => {
  it('returns null without calling createDonation when the localId is not in the outbox', async () => {
    const result = await syncOutboxItem('does-not-exist')
    expect(result).toBeNull()
    expect(createDonation).not.toHaveBeenCalled()
  })

  it('normal success: creates the donation, deletes the outbox row, dispatches queue:changed, returns the server row', async () => {
    const { localId } = await enqueueDonation(donationInput)
    createDonation.mockResolvedValue(serverDonation)
    const spy = captureQueueChanged()

    const result = await syncOutboxItem(localId)

    expect(result).toEqual(serverDonation)
    expect(createDonation).toHaveBeenCalledWith({
      donorName: donationInput.donorName,
      donorPhone: donationInput.donorPhone,
      amountPaise: donationInput.amountPaise,
      mode: donationInput.mode,
      collectedBy: donationInput.collectedBy,
      clientIdempotencyKey: localId,
    })
    expect(await outbox.get(localId)).toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener('queue:changed', spy)
  })

  it('idempotency recovery: a 23505 unique-violation on client_idempotency_key is treated as a successful sync, not a failure', async () => {
    const { localId } = await enqueueDonation(donationInput)
    createDonation.mockRejectedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "donations_client_idempotency_key_key"',
    })
    getDonationByIdempotencyKey.mockResolvedValue(serverDonation)
    const spy = captureQueueChanged()

    const result = await syncOutboxItem(localId)

    expect(result).toEqual(serverDonation)
    expect(getDonationByIdempotencyKey).toHaveBeenCalledWith(localId)
    expect(await outbox.get(localId)).toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener('queue:changed', spy)
  })

  it('network failure: leaves the row queued, returns null, does not throw, does not dispatch queue:changed', async () => {
    const { localId } = await enqueueDonation(donationInput)
    createDonation.mockRejectedValue(new Error('network down'))
    const spy = captureQueueChanged()

    const result = await syncOutboxItem(localId)

    expect(result).toBeNull()
    expect(await outbox.get(localId)).toBeDefined()
    expect(spy).not.toHaveBeenCalled()
    window.removeEventListener('queue:changed', spy)
  })

  it('permanent server rejection: records a failed attempt + reason and dispatches queue:changed (audit #6)', async () => {
    const { localId } = await enqueueDonation(donationInput)
    // A constraint/FK violation (SQLSTATE class 23) is poison — it fails
    // identically on every retry.
    createDonation.mockRejectedValue({ code: '23503', message: 'insert violates foreign key' })
    const spy = captureQueueChanged()

    const result = await syncOutboxItem(localId)

    expect(result).toBeNull()
    expect(await outbox.get(localId)).toMatchObject({ attempts: 1, failedReason: 'insert violates foreign key' })
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener('queue:changed', spy)
  })

  it('transient coded error (e.g. statement timeout): left queued for retry, NOT counted as poison', async () => {
    const { localId } = await enqueueDonation(donationInput)
    // 57014 = statement timeout — transient (DB overload), must not strand the row.
    createDonation.mockRejectedValue({ code: '57014', message: 'canceling statement due to statement timeout' })
    const spy = captureQueueChanged()

    const result = await syncOutboxItem(localId)

    expect(result).toBeNull()
    const stored = await outbox.get(localId)
    expect(stored).toBeDefined()
    expect(stored?.attempts).toBeUndefined() // untouched — will retry
    expect(spy).not.toHaveBeenCalled()
    window.removeEventListener('queue:changed', spy)
  })
})

describe('syncAllPending', () => {
  it('bails out immediately — no outbox read, no createDonation call — when navigator.onLine is false', async () => {
    await enqueueDonation(donationInput)
    vi.stubGlobal('navigator', { ...navigator, onLine: false })

    await syncAllPending()

    expect(outbox.orderBy).not.toHaveBeenCalled()
    expect(createDonation).not.toHaveBeenCalled()
  })

  it('syncs every queued item, in queuedAt order, when online', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: true })
    const first = await enqueueDonation({ ...donationInput, donorName: 'First' })
    const second = await enqueueDonation({ ...donationInput, donorName: 'Second' })
    createDonation.mockResolvedValue(serverDonation)

    await syncAllPending()

    expect(createDonation).toHaveBeenCalledTimes(2)
    expect(createDonation.mock.calls[0][0]).toMatchObject({ clientIdempotencyKey: first.localId })
    expect(createDonation.mock.calls[1][0]).toMatchObject({ clientIdempotencyKey: second.localId })
    expect(await outbox.get(first.localId)).toBeUndefined()
    expect(await outbox.get(second.localId)).toBeUndefined()
  })

  it('syncs only the current session\'s own rows, leaving another user\'s queued rows untouched', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: true })
    // Mine (stamped with the current session by enqueueDonation)…
    const mine = await enqueueDonation(donationInput)
    // …and someone else's, left behind on this shared device.
    await outbox.add({
      localId: 'other-local-id',
      authUserId: 'auth-user-2',
      donorName: 'Not mine',
      donorPhone: '9000000000',
      amountPaise: 999,
      mode: 'cash',
      collectedBy: 'volunteer-2',
      queuedAt: '2000-01-01T00:00:00Z',
    })
    createDonation.mockResolvedValue(serverDonation)

    await syncAllPending()

    expect(createDonation).toHaveBeenCalledTimes(1)
    expect(createDonation.mock.calls[0][0]).toMatchObject({ clientIdempotencyKey: mine.localId })
    // The other user's row is fenced out — still queued, never synced.
    expect(await outbox.get('other-local-id')).toBeDefined()
  })

  it('syncs a row with no authUserId (queued before the field existed), not stranding it', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: true })
    // A pre-upgrade row: no authUserId. It belongs to the current, still
    // signed-in user and must sync rather than be fenced out forever.
    await outbox.add({
      localId: 'pre-upgrade-id',
      donorName: 'Legacy',
      donorPhone: '9000000000',
      amountPaise: 111,
      mode: 'cash',
      collectedBy: 'volunteer-1',
      queuedAt: '2000-01-01T00:00:00Z',
    })
    createDonation.mockResolvedValue(serverDonation)

    await syncAllPending()

    expect(createDonation).toHaveBeenCalledTimes(1)
    expect(createDonation.mock.calls[0][0]).toMatchObject({ clientIdempotencyKey: 'pre-upgrade-id' })
    expect(await outbox.get('pre-upgrade-id')).toBeUndefined() // synced + removed
  })

  it('skips a poison item that has already exhausted MAX_SYNC_ATTEMPTS', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: true })
    const { localId } = await enqueueDonation(donationInput)
    await outbox.update(localId, { attempts: MAX_SYNC_ATTEMPTS })
    createDonation.mockResolvedValue(serverDonation)

    await syncAllPending()

    expect(createDonation).not.toHaveBeenCalled()
    // Still present — surfaced for manual attention, not silently dropped.
    expect(await outbox.get(localId)).toBeDefined()
  })

  it('guards against overlapping concurrent runs with an in-memory re-entrant flag', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: true })
    await enqueueDonation(donationInput)
    let resolveCreate: (value: Tables<'donations'>) => void = () => {}
    // Resolves once createDonation has actually been invoked (i.e. firstRun's
    // async execution reached it, past its own earlier `await`s) — without
    // this, calling resolveCreate() right after kicking off both runs would
    // race ahead of that and resolve a stale no-op instead of the real one.
    const createDonationCalled = new Promise<void>((calledResolve) => {
      createDonation.mockImplementation(
        () =>
          new Promise<Tables<'donations'>>((resolve) => {
            resolveCreate = resolve
            calledResolve()
          }),
      )
    })

    const firstRun = syncAllPending()
    const secondRun = syncAllPending() // must be a no-op — firstRun is still in flight

    await createDonationCalled
    resolveCreate(serverDonation)
    await firstRun
    await secondRun

    expect(createDonation).toHaveBeenCalledTimes(1)
  })
})
