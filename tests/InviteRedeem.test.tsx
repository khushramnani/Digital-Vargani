import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import type { Tables } from '../src/lib/db/database.types'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { InviteRedeem } from '../src/features/auth/InviteRedeem'

// No live Supabase project exists (anonymous sign-in needs one, and it's a
// project-level setting besides), so the real signInAnonymously ->
// redeem_invite round trip can't be exercised here. This drives the
// component through both paths with the Supabase client fully mocked.
const { getSession, signOut, signInAnonymously, onAuthStateChange, rpc, maybeSingle, from } = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  return {
    getSession: vi.fn(),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    signInAnonymously: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    rpc: vi.fn(),
    maybeSingle,
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })),
  }
})

vi.mock('../src/lib/db/client', () => ({
  supabase: {
    auth: { getSession, signOut, signInAnonymously, onAuthStateChange },
    rpc,
    from,
  },
}))

const anonSession = { user: { id: 'anon-uid-1' } } as unknown as Session

const linkedVolunteer: Tables<'users'> = {
  id: 'vol-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  name: 'Test Volunteer',
  phone: null,
  email: null,
  role: 'volunteer',
  invite_token: null,
  auth_user_id: 'anon-uid-1',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
}

function renderInviteRedeem(token: string) {
  render(
    <MemoryRouter initialEntries={[`/invite/${token}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/invite/:token" element={<InviteRedeem />} />
          <Route path="/collect" element={<div>Volunteer Home</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

// Same as renderInviteRedeem, but wrapped in StrictMode to reproduce the
// dev-only double-invoke (mount -> cleanup -> mount again, same component
// instance) that src/main.tsx's real <StrictMode> root triggers.
function renderInviteRedeemStrict(token: string) {
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[`/invite/${token}`]}>
        <AuthProvider>
          <Routes>
            <Route path="/invite/:token" element={<InviteRedeem />} />
            <Route path="/collect" element={<div>Volunteer Home</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  )
}

// Once signInAnonymously "succeeds", subsequent getSession() calls (made by
// AuthProvider's refreshAppUser and by InviteRedeem's own pre-check) should
// see the new anonymous session — mirroring a real client's behavior of
// caching the freshly-established session.
function succeedAnonymousSignIn() {
  signInAnonymously.mockImplementation(() => {
    getSession.mockResolvedValue({ data: { session: anonSession }, error: null })
    return Promise.resolve({ data: { session: anonSession, user: anonSession.user }, error: null })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  from.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }))
  getSession.mockResolvedValue({ data: { session: null }, error: null })
  signOut.mockResolvedValue({ error: null })
})

// The page now resolves invite_preview BEFORE redeeming — it names the mandal
// in the welcome copy and, crucially, tells a dead token apart from a failed
// sign-in. So the rpc mock has to answer by function name: `preview: []` is an
// unknown/already-redeemed token, `redeem` controls only the redeem_invite leg.
// (AuthProvider's own link_admin_account call falls through harmlessly.)
function mockRpc(opts: { preview?: unknown[]; redeem?: { data: unknown; error: unknown } } = {}) {
  const preview = opts.preview ?? [{ mandal_name: 'Vinayak Mitra Mandal', volunteer_name: 'Sita Volunteer' }]
  const redeem = opts.redeem ?? { data: null, error: null }
  rpc.mockImplementation((fn: string) =>
    Promise.resolve(fn === 'invite_preview' ? { data: preview, error: null } : redeem),
  )
}

describe('InviteRedeem', () => {
  it('redeems a valid invite, refreshes appUser, and redirects to /collect', async () => {
    succeedAnonymousSignIn()
    mockRpc()
    maybeSingle.mockResolvedValue({ data: linkedVolunteer, error: null })

    renderInviteRedeem('good-token')

    await waitFor(() => expect(screen.getByText('Volunteer Home')).toBeInTheDocument())
    expect(signInAnonymously).toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('redeem_invite', { token: 'good-token' })
    expect(signOut).not.toHaveBeenCalled() // no lingering session to sign out
  })

  it("asks before switching when a real session is present, then signs it out on confirm", async () => {
    // A logged-in admin (non-anonymous) tapping a volunteer link must not be
    // silently signed out and burn the token — confirm first (audit #4).
    const staleSession = { user: { id: 'stale-uid', is_anonymous: false } } as unknown as Session
    getSession.mockResolvedValue({ data: { session: staleSession }, error: null })
    succeedAnonymousSignIn()
    mockRpc()
    maybeSingle.mockResolvedValue({ data: linkedVolunteer, error: null })

    renderInviteRedeem('good-token')

    // The confirm prompt appears; nothing destructive has happened yet.
    // (AuthProvider fires link_admin_account on mount, so assert specifically
    // that the invite hasn't been redeemed, not that rpc is untouched.)
    await waitFor(() => expect(screen.getByText('Continue and switch')).toBeInTheDocument())
    expect(signOut).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalledWith('redeem_invite', expect.anything())

    fireEvent.click(screen.getByText('Continue and switch'))

    await waitFor(() => expect(screen.getByText('Volunteer Home')).toBeInTheDocument())
    expect(signOut).toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('redeem_invite', { token: 'good-token' })
  })

  it('proceeds without a prompt when the existing session is anonymous (volunteer re-opening their link)', async () => {
    const anonExisting = { user: { id: 'anon-old', is_anonymous: true } } as unknown as Session
    getSession.mockResolvedValue({ data: { session: anonExisting }, error: null })
    succeedAnonymousSignIn()
    mockRpc()
    maybeSingle.mockResolvedValue({ data: linkedVolunteer, error: null })

    renderInviteRedeem('good-token')

    await waitFor(() => expect(screen.getByText('Volunteer Home')).toBeInTheDocument())
    expect(screen.queryByText('Continue and switch')).not.toBeInTheDocument()
    expect(signOut).toHaveBeenCalled()
  })

  // A LIVE token whose sign-in fails is NOT a bad link. Reporting it as
  // "invalid or already used" is what made a disabled anonymous-sign-in
  // provider look like a broken invite and sent an admin hunting a token bug.
  it('reports a failed sign-in as a session problem, not an invalid link', async () => {
    mockRpc() // the token itself is live
    signInAnonymously.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Anonymous sign-ins are disabled', name: 'AuthApiError', status: 422 },
    })

    renderInviteRedeem('good-token')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn't start your volunteer session/i))
    expect(screen.getByText(/your link is fine/i)).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalledWith('redeem_invite', expect.anything())
    expect(screen.queryByText('Volunteer Home')).not.toBeInTheDocument()
  })

  it('shows the invalid-link state for an unknown token without attempting a sign-in', async () => {
    mockRpc({ preview: [] }) // unknown or already-redeemed

    renderInviteRedeem('used-token')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid or has already been used/i))
    expect(signInAnonymously).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalledWith('redeem_invite', expect.anything())
  })

  it('names the inviting mandal once the token is confirmed live', async () => {
    succeedAnonymousSignIn()
    // Hold redeem_invite open so the component stays on the setting-up screen;
    // otherwise it redirects to /collect before the welcome copy can be read.
    rpc.mockImplementation((fn: string) =>
      fn === 'invite_preview'
        ? Promise.resolve({
            data: [{ mandal_name: 'Vinayak Mitra Mandal', volunteer_name: 'Sita Volunteer' }],
            error: null,
          })
        : new Promise(() => {}),
    )

    renderInviteRedeem('good-token')

    await waitFor(() => expect(screen.getByText('Vinayak Mitra Mandal')).toBeInTheDocument())
    expect(screen.getByText(/invited as a volunteer for/i)).toBeInTheDocument()
  })

  it('shows an error state (not a redirect) when redeem_invite rejects an invalid/used token', async () => {
    succeedAnonymousSignIn()
    mockRpc({ redeem: { data: null, error: { message: 'invalid or already-used invite link' } } })

    renderInviteRedeem('used-token')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid or has already been used/i))
    expect(screen.queryByText('Volunteer Home')).not.toBeInTheDocument()
  })

  // Regression test for the StrictMode double-invoke race: dev builds run
  // this component's mount effect twice (mount -> cleanup -> mount again,
  // same instance). Without the startedRef guard, both invocations fire
  // signInAnonymously()/redeem_invite() against the same one-time-use
  // token, and whichever reaches Postgres second gets the "already used"
  // error — even if it's the "real" invocation. This wraps the render in
  // an actual <StrictMode> (matching src/main.tsx) to reproduce that.
  it('calls redeem_invite exactly once under StrictMode double-invoke', async () => {
    succeedAnonymousSignIn()
    mockRpc()
    maybeSingle.mockResolvedValue({ data: linkedVolunteer, error: null })

    renderInviteRedeemStrict('good-token')

    await waitFor(() => expect(screen.getByText('Volunteer Home')).toBeInTheDocument())
    expect(signInAnonymously).toHaveBeenCalledTimes(1)
    // Count the REDEEM calls specifically — the page also calls invite_preview
    // (and AuthProvider calls link_admin_account), so a bare total would no
    // longer isolate the one-time-token race this guards.
    expect(rpc.mock.calls.filter((c: unknown[]) => c[0] === 'redeem_invite')).toHaveLength(1)
  })
})
