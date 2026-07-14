import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import type { Tables } from '../src/lib/db/database.types'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { RequireRole } from '../src/features/auth/RequireRole'

// No live Supabase project exists yet, so the actual magic-link/invite-link
// round trips can't be tested here. This proves the guard logic itself
// instead: given a mocked session + mocked `users` row, does RequireRole
// render its children or redirect for a given required role? (The
// no-session redirect is also covered for real, with no mocking needed, by
// e2e/admin-auth.spec.ts.)
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

function renderGuardedRoute(requiredRole: 'admin' | 'volunteer') {
  render(
    <MemoryRouter initialEntries={['/guarded']}>
      <AuthProvider>
        <Routes>
          <Route
            path="/guarded"
            element={
              <RequireRole role={requiredRole}>
                <div>Guarded Content</div>
              </RequireRole>
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

describe('RequireRole', () => {
  it('renders its children for an authenticated session resolving to a matching-role appUser', async () => {
    getSession.mockResolvedValue({ data: { session: fakeSession }, error: null })
    maybeSingle.mockResolvedValue({ data: adminUser, error: null })

    renderGuardedRoute('admin')

    await waitFor(() => expect(screen.getByText('Guarded Content')).toBeInTheDocument())
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
  })

  it('redirects to /login when there is no session at all', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })

    renderGuardedRoute('admin')

    await waitFor(() => expect(screen.getByText('Login Page')).toBeInTheDocument())
    expect(screen.queryByText('Guarded Content')).not.toBeInTheDocument()
  })

  it('blocks a volunteer appUser from an admin-gated route', async () => {
    getSession.mockResolvedValue({ data: { session: fakeSession }, error: null })
    maybeSingle.mockResolvedValue({ data: volunteerUser, error: null })

    renderGuardedRoute('admin')

    await waitFor(() => expect(screen.getByText('Login Page')).toBeInTheDocument())
    expect(screen.queryByText('Guarded Content')).not.toBeInTheDocument()
  })

  it('blocks an admin appUser from a volunteer-gated route (vice versa)', async () => {
    getSession.mockResolvedValue({ data: { session: fakeSession }, error: null })
    maybeSingle.mockResolvedValue({ data: adminUser, error: null })

    renderGuardedRoute('volunteer')

    await waitFor(() => expect(screen.getByText('Login Page')).toBeInTheDocument())
    expect(screen.queryByText('Guarded Content')).not.toBeInTheDocument()
  })
})
