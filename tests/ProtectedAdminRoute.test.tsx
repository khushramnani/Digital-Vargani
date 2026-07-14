import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import type { Tables } from '../src/lib/db/database.types'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { ProtectedAdminRoute } from '../src/features/auth/ProtectedAdminRoute'

// No live Supabase project exists yet, so the actual magic-link round trip
// can't be tested. This proves the guard logic itself instead: given a
// mocked session + mocked `users` row, does ProtectedAdminRoute render its
// children or redirect? (The unauthenticated-redirect case is covered for
// real, with no mocking needed, by e2e/admin-auth.spec.ts.)
const { getSession, onAuthStateChange, rpc, maybeSingle, from } = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  return {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    maybeSingle,
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })),
  }
})

vi.mock('../src/lib/db/client', () => ({
  supabase: {
    auth: { getSession, onAuthStateChange },
    rpc,
    from,
  },
}))

const fakeSession = { user: { id: 'auth-uid-1' } } as unknown as Session

const adminUser: Tables<'users'> = {
  id: 'user-1',
  name: 'Admin Treasurer',
  phone: null,
  email: 'admin@example.com',
  role: 'admin',
  invite_token: null,
  auth_user_id: 'auth-uid-1',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
}

const volunteerUser: Tables<'users'> = { ...adminUser, id: 'user-2', role: 'volunteer' }

function renderGuardedAdminRoute() {
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <AuthProvider>
        <Routes>
          <Route
            path="/admin"
            element={
              <ProtectedAdminRoute>
                <div>Admin Content</div>
              </ProtectedAdminRoute>
            }
          />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  rpc.mockResolvedValue({ data: null, error: null })
  from.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }))
})

describe('ProtectedAdminRoute', () => {
  it('renders its children for an authenticated session resolving to an admin appUser', async () => {
    getSession.mockResolvedValue({ data: { session: fakeSession }, error: null })
    maybeSingle.mockResolvedValue({ data: adminUser, error: null })

    renderGuardedAdminRoute()

    await waitFor(() => expect(screen.getByText('Admin Content')).toBeInTheDocument())
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
  })

  it('redirects to /login when there is no session at all', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })

    renderGuardedAdminRoute()

    await waitFor(() => expect(screen.getByText('Login Page')).toBeInTheDocument())
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument()
  })

  it('redirects to /login when the session resolves to a non-admin appUser', async () => {
    getSession.mockResolvedValue({ data: { session: fakeSession }, error: null })
    maybeSingle.mockResolvedValue({ data: volunteerUser, error: null })

    renderGuardedAdminRoute()

    await waitFor(() => expect(screen.getByText('Login Page')).toBeInTheDocument())
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument()
  })
})
