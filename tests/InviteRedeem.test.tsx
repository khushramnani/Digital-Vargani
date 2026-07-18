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

describe('InviteRedeem', () => {
  it('redeems a valid invite, refreshes appUser, and redirects to /collect', async () => {
    succeedAnonymousSignIn()
    rpc.mockResolvedValue({ data: null, error: null })
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
    rpc.mockResolvedValue({ data: null, error: null })
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
    rpc.mockResolvedValue({ data: null, error: null })
    maybeSingle.mockResolvedValue({ data: linkedVolunteer, error: null })

    renderInviteRedeem('good-token')

    await waitFor(() => expect(screen.getByText('Volunteer Home')).toBeInTheDocument())
    expect(screen.queryByText('Continue and switch')).not.toBeInTheDocument()
    expect(signOut).toHaveBeenCalled()
  })

  it('shows an error state (not a redirect) when signInAnonymously fails', async () => {
    signInAnonymously.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Anonymous sign-ins are disabled', name: 'AuthApiError', status: 422 },
    })

    renderInviteRedeem('bad-token')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid or has already been used/i))
    expect(rpc).not.toHaveBeenCalled()
    expect(screen.queryByText('Volunteer Home')).not.toBeInTheDocument()
  })

  it('shows an error state (not a redirect) when redeem_invite rejects an invalid/used token', async () => {
    succeedAnonymousSignIn()
    rpc.mockResolvedValue({ data: null, error: { message: 'invalid or already-used invite link' } })

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
    rpc.mockResolvedValue({ data: null, error: null })
    maybeSingle.mockResolvedValue({ data: linkedVolunteer, error: null })

    renderInviteRedeemStrict('good-token')

    await waitFor(() => expect(screen.getByText('Volunteer Home')).toBeInTheDocument())
    expect(signInAnonymously).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
