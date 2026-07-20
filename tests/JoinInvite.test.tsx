import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { JoinInvite } from '../src/features/auth/JoinInvite'

const { getSession, onAuthStateChange, rpc, from } = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  return {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }),
    })),
  }
})

vi.mock('../src/lib/db/client', () => ({
  supabase: { auth: { getSession, onAuthStateChange }, rpc, from },
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

function mockRpc(opts: { preview?: unknown[]; accept?: { data: unknown; error: unknown } } = {}) {
  const preview = opts.preview ?? [{ mandal_name: 'Vinayak Mitra Mandal', role: 'volunteer', invitee_name: 'Sita Volunteer' }]
  const accept = opts.accept ?? { data: null, error: null }
  rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'invite_preview' ? { data: preview, error: null } : accept))
}

beforeEach(() => {
  vi.clearAllMocks()
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
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
    mockRpc({ preview: [{ mandal_name: 'Vinayak Mitra Mandal', role: 'admin', invitee_name: 'New Admin' }] })
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
    mockRpc({ accept: { data: null, error: { message: 'this invite is locked to a different email address' } } })
    renderJoinInvite('good-token')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/locked to a different email/i))
    expect(screen.queryByText('Volunteer Home')).not.toBeInTheDocument()
  })
})
