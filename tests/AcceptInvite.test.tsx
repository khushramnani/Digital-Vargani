import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { AcceptInvite } from '../src/features/auth/AcceptInvite'
import { stashInvite, readStashedInvite } from '../src/features/auth/inviteStash'
import type { InvitePreview } from '../src/lib/db/members'

const { rpc, refreshAppUser, useAuthMock } = vi.hoisted(() => ({
  rpc: vi.fn(),
  refreshAppUser: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../src/lib/db/client', () => ({ supabase: { rpc } }))
vi.mock('../src/features/auth/useAuth', () => ({ useAuth: () => useAuthMock() }))

const PREVIEW: InvitePreview = {
  mandalName: 'Vinayak Mitra Mandal',
  role: 'volunteer',
  invitee: 'Priya',
  inviteeEmailMasked: null,
  matchesCallerEmail: true,
}

// Both real callers (JoinInvite and AuthResolver) pass inline arrow
// callbacks, so every PARENT re-render changes this component's effect
// dependencies. AuthProvider rebuilds its context value on each auth event —
// token refresh, tab focus — which re-renders both of them. `bump` stands in
// for that, and it is the only way to observe the class of bug below:
// AcceptInvite's own setState re-renders itself but keeps the props'
// identity, so a self-render alone can never expose it.
function Parent({ preview = PREVIEW, onAccepted = () => {} }: { preview?: InvitePreview; onAccepted?: (r: string) => void }) {
  const [, bump] = useState(0)
  return (
    <>
      <button onClick={() => bump((n) => n + 1)}>bump</button>
      <AcceptInvite
        token="tok-1"
        preview={preview}
        onAccepted={onAccepted}
        onFailed={() => {}}
        onCancel={() => {}}
      />
    </>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAuthMock.mockReturnValue({
    session: { user: { id: 'auth-1', email: 'priya@example.com' } },
    appUser: null,
    refreshAppUser,
  })
})

async function bumpParent(times: number) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      fireEvent.click(screen.getByText('bump'))
    })
  }
}

describe('AcceptInvite', () => {
  it('accepts exactly once on the happy path, however often the parent re-renders', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const onAccepted = vi.fn()
    render(<Parent onAccepted={onAccepted} />)

    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith('volunteer'))
    await bumpParent(3)

    expect(rpc.mock.calls.filter(([fn]) => fn === 'accept_invite')).toHaveLength(1)
  })

  // The regression. A failed accept is terminal: this screen offers no retry,
  // so re-attempting on every auth event would quietly hammer the server for
  // as long as someone leaves a dead invite page open.
  it('never re-attempts a failed accept, even as the parent re-renders', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'this invite link has expired' } })
    stashInvite('tok-1')
    render(<Parent />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/has expired/i))
    expect(rpc.mock.calls.filter(([fn]) => fn === 'accept_invite')).toHaveLength(1)

    await bumpParent(3)

    expect(rpc.mock.calls.filter(([fn]) => fn === 'accept_invite')).toHaveLength(1)
    // And the dead token is not left behind to re-fire on a later visit.
    expect(readStashedInvite()).toBeNull()
  })

  it('holds behind the second-mandal confirm without touching the server', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    useAuthMock.mockReturnValue({
      session: { user: { id: 'auth-1', email: 'priya@example.com' } },
      appUser: { role: 'admin' },
      refreshAppUser,
    })
    render(<Parent />)

    await bumpParent(2)
    expect(rpc).not.toHaveBeenCalled()
  })

  // An existing member opening a link addressed to someone else trips BOTH
  // gates; clearing one must reveal the other rather than joining.
  it('chains the second-mandal confirm into the mismatch confirm', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    useAuthMock.mockReturnValue({
      session: { user: { id: 'auth-1', email: 'rahul@example.com' } },
      appUser: { role: 'admin' },
      refreshAppUser,
    })
    render(<Parent preview={{ ...PREVIEW, matchesCallerEmail: false, inviteeEmailMasked: 'p***a@example.com' }} />)

    fireEvent.click(screen.getByText(/Join anyway/i))
    await waitFor(() => expect(screen.getByText(/sent to someone else/i)).toBeInTheDocument())
    expect(rpc).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText(/Continue anyway/i))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('accept_invite', { token: 'tok-1' }))
  })
})
