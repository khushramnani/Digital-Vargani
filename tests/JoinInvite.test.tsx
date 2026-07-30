import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { JoinInvite } from '../src/features/auth/JoinInvite'
import { readStashedInvite } from '../src/features/auth/inviteStash'
import { strings } from '../src/lib/strings'

const { getSession, onAuthStateChange, signInWithOAuth, signOut, rpc, from } = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  // fetchAppUser chains .eq().eq().order().order().limit() before the
  // terminal .maybeSingle() (auth_user_id + active) — this stub chain
  // supports any number of those calls before resolving.
  const chain: {
    eq: () => typeof chain
    order: () => typeof chain
    limit: () => typeof chain
    maybeSingle: typeof maybeSingle
  } = {
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle,
  }
  return {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signInWithOAuth: vi.fn(() => Promise.resolve({ error: null })),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    rpc: vi.fn(),
    from: vi.fn(() => ({ select: () => chain })),
  }
})

vi.mock('../src/lib/db/client', () => ({
  supabase: { auth: { getSession, onAuthStateChange, signInWithOAuth, signOut }, rpc, from },
}))

const realSession = { user: { id: 'real-uid-1', is_anonymous: false } } as unknown as Session

function renderJoinInvite(token: string) {
  render(
    <MemoryRouter initialEntries={[`/join/${token}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/join/:token" element={<JoinInvite />} />
          <Route path="/admin" element={<div>Admin Home</div>} />
          <Route path="/collect" element={<div>Volunteer Home</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

// matches_caller_email defaults to true: these fixtures describe the normal
// case where the invitee signed in with the address they were invited at.
// The mismatch path has its own test below.
function previewRow(over: Record<string, unknown> = {}) {
  return {
    mandal_name: 'Vinayak Mitra Mandal',
    role: 'volunteer',
    invitee_name: 'Sita Volunteer',
    invitee_email_masked: 's***a@example.com',
    matches_caller_email: true,
    ...over,
  }
}

function mockRpc(opts: { preview?: unknown[]; accept?: { data: unknown; error: unknown } } = {}) {
  const preview = opts.preview ?? [previewRow()]
  const accept = opts.accept ?? { data: null, error: null }
  rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'invite_preview' ? { data: preview, error: null } : accept))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  signInWithOAuth.mockResolvedValue({ error: null })
  signOut.mockResolvedValue({ error: null })
  getSession.mockResolvedValue({ data: { session: null }, error: null })
})

describe('JoinInvite', () => {
  it('shows the invalid state for an unknown token', async () => {
    mockRpc({ preview: [] })
    renderJoinInvite('bad-token')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid or has expired/i))
  })

  it('names the mandal + role and offers Google/email when there is no session', async () => {
    mockRpc()
    renderJoinInvite('good-token')
    await waitFor(() => expect(screen.getByText('Vinayak Mitra Mandal')).toBeInTheDocument())
    expect(screen.getByText(/invites you as/i)).toBeInTheDocument()
    expect(screen.getByText('Continue with Google')).toBeInTheDocument()
  })

  it('auto-accepts and routes to /collect for a volunteer once a real session is present', async () => {
    getSession.mockResolvedValue({ data: { session: realSession }, error: null })
    mockRpc()
    renderJoinInvite('good-token')
    await waitFor(() => expect(screen.getByText('Volunteer Home')).toBeInTheDocument())
    expect(rpc).toHaveBeenCalledWith('accept_invite', { token: 'good-token' })
  })

  it('routes to /admin for an admin-role invite', async () => {
    getSession.mockResolvedValue({ data: { session: realSession }, error: null })
    mockRpc({ preview: [previewRow({ role: 'admin', invitee_name: 'New Admin' })] })
    renderJoinInvite('admin-token')
    await waitFor(() => expect(screen.getByText('Admin Home')).toBeInTheDocument())
  })

  it('does not auto-accept on an anonymous session — shows the auth methods instead', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'x', is_anonymous: true } } }, error: null })
    mockRpc()
    renderJoinInvite('good-token')
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument())
    expect(rpc).not.toHaveBeenCalledWith('accept_invite', expect.anything())
  })

  it('shows an accept error without navigating away', async () => {
    getSession.mockResolvedValue({ data: { session: realSession }, error: null })
    mockRpc({ accept: { data: null, error: { message: 'this invite link has expired' } } })
    renderJoinInvite('good-token')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/has expired/i))
    expect(screen.queryByText('Volunteer Home')).not.toBeInTheDocument()
  })

  // v6: the email lock is gone, so a mismatch is legal — but it is usually
  // the wrong Google account picked on a shared phone, which is worth one
  // tap to catch. It must ask BEFORE accepting, not report afterwards.
  it('asks before joining when the invite names a different address', async () => {
    getSession.mockResolvedValue({ data: { session: realSession }, error: null })
    mockRpc({ preview: [previewRow({ matches_caller_email: false })] })
    renderJoinInvite('good-token')

    await waitFor(() => expect(screen.getByText(/sent to someone else/i)).toBeInTheDocument())
    expect(screen.getByText(/s\*\*\*a@example\.com/)).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalledWith('accept_invite', expect.anything())

    fireEvent.click(screen.getByText(strings.resolver.mismatchConfirm))
    await waitFor(() => expect(screen.getByText('Volunteer Home')).toBeInTheDocument())
    expect(rpc).toHaveBeenCalledWith('accept_invite', { token: 'good-token' })
  })

  // The bug this whole change exists for: if the project's Supabase redirect
  // allowlist doesn't cover /join/*, the auth round trip comes back to the
  // landing page and the token in the URL is simply gone. Stashing it first
  // is what lets AuthResolver still finish the join from wherever they land.
  it('stashes the token before handing off to Google', async () => {
    mockRpc()
    renderJoinInvite('good-token')
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument())
    expect(readStashedInvite()).toBeNull()

    fireEvent.click(screen.getByText('Continue with Google'))
    await waitFor(() => expect(readStashedInvite()).toBe('good-token'))
  })
})
