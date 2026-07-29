import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthResolver } from '../src/features/auth/AuthResolver'
import { stashInvite, readStashedInvite } from '../src/features/auth/inviteStash'
import { strings } from '../src/lib/strings'

const t = strings.resolver

const { rpc, signOut, refreshAppUser, useAuthMock } = vi.hoisted(() => ({
  rpc: vi.fn(),
  signOut: vi.fn(() => Promise.resolve({ error: null })),
  refreshAppUser: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../src/lib/db/client', () => ({ supabase: { rpc, auth: { signOut } } }))
vi.mock('../src/features/auth/useAuth', () => ({ useAuth: () => useAuthMock() }))

const SESSION = { user: { id: 'auth-1', email: 'priya@example.com', is_anonymous: false } }

function setAuth(appUser: unknown = null) {
  useAuthMock.mockReturnValue({ loading: false, session: SESSION, appUser, refreshAppUser })
}

function mockRpc(opts: { preview?: unknown[]; mine?: unknown[]; acceptError?: { message: string } } = {}) {
  rpc.mockImplementation((fn: string) => {
    if (fn === 'invite_preview') return Promise.resolve({ data: opts.preview ?? [], error: null })
    if (fn === 'my_pending_invites') return Promise.resolve({ data: opts.mine ?? [], error: null })
    if (fn === 'accept_invite') return Promise.resolve({ data: null, error: opts.acceptError ?? null })
    return Promise.resolve({ data: null, error: null })
  })
}

const PREVIEW = {
  mandal_name: 'Vinayak Mitra Mandal',
  role: 'volunteer',
  invitee_name: 'Priya',
  invitee_email_masked: 'p***a@example.com',
  matches_caller_email: true,
}

function renderResolver() {
  render(
    <MemoryRouter initialEntries={['/continue']}>
      <Routes>
        <Route path="/continue" element={<AuthResolver />} />
        <Route path="/admin" element={<div>Admin Home</div>} />
        <Route path="/collect" element={<div>Volunteer Home</div>} />
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/signup" element={<div>Signup Page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  signOut.mockResolvedValue({ error: null })
})

// This screen is the fix for the bug the whole change exists for: an invitee
// whose auth redirect came back to the wrong URL used to hold a valid
// session, no membership, and a token nobody was still holding. The ORDER of
// its questions is the contract, so each step is asserted against the ones
// that should lose to it.
describe('AuthResolver', () => {
  it('finishes a join from a stashed token, even though the URL no longer has it', async () => {
    setAuth()
    mockRpc({ preview: [PREVIEW] })
    stashInvite('stashed-token')

    renderResolver()

    await waitFor(() => expect(screen.getByText('Volunteer Home')).toBeInTheDocument())
    expect(rpc).toHaveBeenCalledWith('accept_invite', { token: 'stashed-token' })
    // A consumed stash must not linger and re-fire on the next visit.
    expect(readStashedInvite()).toBeNull()
  })

  // The v2 plan's central correction: a dead stash is not a dead end.
  it('clears a dead stashed token, says why, and still routes an existing member home', async () => {
    setAuth({ role: 'admin' })
    mockRpc({ preview: [] }) // token no longer resolves
    stashInvite('expired-token')

    renderResolver()

    await waitFor(() => expect(screen.getByText('Admin Home')).toBeInTheDocument())
    expect(rpc).not.toHaveBeenCalledWith('accept_invite', expect.anything())
    expect(readStashedInvite()).toBeNull()
  })

  it('ignores a stash older than the invite could possibly live', async () => {
    setAuth({ role: 'volunteer' })
    mockRpc({ preview: [PREVIEW] })
    localStorage.setItem(
      'vm.pendingInvite',
      JSON.stringify({ token: 'ancient', writtenAt: Date.now() - 8 * 86_400_000 }),
    )

    renderResolver()

    await waitFor(() => expect(screen.getByText('Volunteer Home')).toBeInTheDocument())
    expect(rpc).not.toHaveBeenCalledWith('invite_preview', expect.anything())
  })

  it('routes an existing member by role without hunting for invites', async () => {
    setAuth({ role: 'owner' })
    mockRpc({ mine: [{ code: 'K7M29XPQ4R', mandal_name: 'Other Mandal', role: 'admin', invitee_name: 'Priya' }] })

    renderResolver()

    await waitFor(() => expect(screen.getByText('Admin Home')).toBeInTheDocument())
    expect(rpc).not.toHaveBeenCalledWith('my_pending_invites', expect.anything())
  })

  // The magic-link rescue: the stash cannot survive Gmail opening the link in
  // a different browser, so matching the verified email is the ONLY way back.
  it('claims the single invite waiting on the signed-in email', async () => {
    setAuth()
    mockRpc({ mine: [{ code: 'K7M29XPQ4R', mandal_name: 'Vinayak Mitra Mandal', role: 'volunteer', invitee_name: 'Priya' }] })

    renderResolver()

    await waitFor(() => expect(screen.getByText('Volunteer Home')).toBeInTheDocument())
    expect(rpc).toHaveBeenCalledWith('accept_invite', { token: 'K7M29XPQ4R' })
  })

  it('offers a picker for two invites rather than silently taking the newest', async () => {
    setAuth()
    mockRpc({
      mine: [
        { code: 'AAAAAAAAAA', mandal_name: 'Ganesh Mandal', role: 'volunteer', invitee_name: 'Priya' },
        { code: 'BBBBBBBBBB', mandal_name: 'Vinayak Mandal', role: 'admin', invitee_name: 'Priya' },
      ],
    })

    renderResolver()

    await waitFor(() => expect(screen.getByText(t.pickTitle)).toBeInTheDocument())
    expect(screen.getByText('Ganesh Mandal')).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalledWith('accept_invite', expect.anything())

    fireEvent.click(screen.getByText('Vinayak Mandal'))
    await waitFor(() => expect(screen.getByText('Admin Home')).toBeInTheDocument())
    expect(rpc).toHaveBeenCalledWith('accept_invite', { token: 'BBBBBBBBBB' })
  })

  it('hands a person with nothing to join to /signup, carrying the address that missed', async () => {
    setAuth()
    mockRpc({ mine: [] })

    renderResolver()

    await waitFor(() => expect(screen.getByText('Signup Page')).toBeInTheDocument())
  })

  // Joining a second mandal switches which tenant the session acts in
  // (app_mandal_id() resolves to the newest-joined), so it cannot happen
  // silently under an existing member.
  it('asks before adding a second mandal to an existing member', async () => {
    setAuth({ role: 'admin' })
    mockRpc({ preview: [{ ...PREVIEW, mandal_name: 'Second Mandal' }] })
    stashInvite('second-mandal-token')

    renderResolver()

    await waitFor(() => expect(screen.getByText(t.secondMandalTitle)).toBeInTheDocument())
    expect(rpc).not.toHaveBeenCalledWith('accept_invite', expect.anything())

    fireEvent.click(screen.getByText(t.secondMandalConfirm))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('accept_invite', { token: 'second-mandal-token' }))
  })

  it('leaves an existing member exactly where they were if they decline', async () => {
    setAuth({ role: 'admin' })
    mockRpc({ preview: [{ ...PREVIEW, mandal_name: 'Second Mandal' }] })
    stashInvite('second-mandal-token')

    renderResolver()

    await waitFor(() => expect(screen.getByText(t.secondMandalTitle)).toBeInTheDocument())
    fireEvent.click(screen.getByText(t.cancel))

    await waitFor(() => expect(screen.getByText('Admin Home')).toBeInTheDocument())
    expect(rpc).not.toHaveBeenCalledWith('accept_invite', expect.anything())
    expect(signOut).not.toHaveBeenCalled()
  })

  it('signs out when a non-member says the account is the wrong one', async () => {
    setAuth()
    mockRpc({ preview: [{ ...PREVIEW, matches_caller_email: false }] })
    stashInvite('someone-elses-token')

    renderResolver()

    await waitFor(() => expect(screen.getByText(t.mismatchTitle)).toBeInTheDocument())
    fireEvent.click(screen.getByText(t.switchAccount))

    await waitFor(() => expect(signOut).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Login Page')).toBeInTheDocument())
  })

  it('surfaces a failed accept instead of looping on it forever', async () => {
    setAuth()
    mockRpc({ preview: [PREVIEW], acceptError: { message: 'this invite link has expired' } })
    stashInvite('doomed-token')

    renderResolver()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/has expired/i))
    expect(readStashedInvite()).toBeNull()
  })
})
