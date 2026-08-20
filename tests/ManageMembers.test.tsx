import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import type { Tables } from '../src/lib/db/database.types'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { ManageMembersContent } from '../src/features/settings/members'
import { strings } from '../src/lib/strings'

// Same pattern as RequireRole.test.tsx/JoinInvite.test.tsx: mock the raw
// Supabase client, not members.ts — this screen's authorization-sensitive
// RPC calls (create_invite/set_member_role/etc.) are the thing worth
// proving, so the assertions need to see the real request shape members.ts
// builds, not a stubbed-out wrapper.
//
// One `chain` object serves two different `users`-table query shapes:
//   - AuthProvider's fetchAppUser: .eq().order().order().limit().maybeSingle()
//   - members.ts's fetchMembers:   .order('created_at', {...}) awaited directly
// `.maybeSingle()` resolves via its own vi.fn(); every other step returns the
// same chain, and awaiting the chain itself (fetchMembers never calls
// .maybeSingle()) resolves through the synthetic `.then()` below.
// mandalFilter tracks a `.eq('mandal_id', ...)` call so the shared chain's
// `.then()` (fetchMembers' resolution path) can actually filter membersRef —
// the only way to prove cross-mandal exclusion behaviourally rather than by
// just asserting call args. Reset in `from()`, the start of every fresh
// `.from('users')...` query, so a prior call's filter can't leak into the
// next one.
const { getSession, onAuthStateChange, rpc, from, maybeSingle, membersRef, invitesRef } = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const membersRef: { current: unknown[] } = { current: [] }
  const invitesRef: { current: unknown[] } = { current: [] }
  let mandalFilter: string | undefined
  const chain: {
    eq: (column: string, value: string) => typeof chain
    order: () => typeof chain
    limit: () => typeof chain
    maybeSingle: typeof maybeSingle
    then: (resolve: (v: { data: unknown; error: null }) => void) => void
  } = {
    eq: (column, value) => {
      if (column === 'mandal_id') mandalFilter = value
      return chain
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle,
    then: (resolve) => {
      const rows = mandalFilter
        ? (membersRef.current as { mandal_id: string }[]).filter((r) => r.mandal_id === mandalFilter)
        : membersRef.current
      resolve({ data: rows, error: null })
    },
  }
  return {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    rpc: vi.fn(),
    from: vi.fn(() => {
      mandalFilter = undefined
      return { select: () => chain }
    }),
    maybeSingle,
    membersRef,
    invitesRef,
  }
})

vi.mock('../src/lib/db/client', () => ({
  supabase: { auth: { getSession, onAuthStateChange }, rpc, from },
}))

const t = strings.members
const fakeSession = { user: { id: 'auth-uid-1' } } as unknown as Session
const MANDAL_ID = '11111111-1111-1111-1111-000000000001'

function makeUser(overrides: Partial<Tables<'users'>>): Tables<'users'> {
  return {
    id: 'user-x',
    mandal_id: MANDAL_ID,
    name: 'Someone',
    phone: null,
    email: null,
    role: 'volunteer',
    auth_user_id: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const ownerViewer = makeUser({ id: 'user-owner', role: 'owner', name: 'Ollie Owner', auth_user_id: 'auth-uid-1' })
const adminViewer = makeUser({ id: 'user-admin-viewer', role: 'admin', name: 'Ava Admin', auth_user_id: 'auth-uid-1' })

const adminRow = makeUser({ id: 'user-admin-2', role: 'admin', name: 'Amit Admin', email: 'amit@example.com' })
const volunteerRow = makeUser({ id: 'user-vol-1', role: 'volunteer', name: 'Vera Volunteer', phone: '+919876500001' })

const pendingInviteRow = {
  id: 'invite-1',
  role: 'volunteer',
  name: 'Ishaan Invitee',
  email: null,
  phone: '+919999999999',
  expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  created_at: '2026-07-01T00:00:00Z',
}

function setViewer(user: Tables<'users'>) {
  maybeSingle.mockResolvedValue({ data: user, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ data: { session: fakeSession }, error: null })
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  membersRef.current = [adminRow, volunteerRow]
  invitesRef.current = [pendingInviteRow]
  rpc.mockImplementation((fn: string) => {
    if (fn === 'list_pending_invites') return Promise.resolve({ data: invitesRef.current, error: null })
    if (fn === 'create_invite') return Promise.resolve({ data: [{ token: 'tok-abc123', code: 'K7M29XPQ4R' }], error: null })
    if (fn === 'resend_invite') return Promise.resolve({ data: [{ token: 'tok-resend-999', code: 'B4TXW8ZDNH' }], error: null })
    return Promise.resolve({ data: null, error: null })
  })
  setViewer(ownerViewer)
})

function renderMembers() {
  return render(
    <AuthProvider>
      <ManageMembersContent />
    </AuthProvider>,
  )
}

const dialog = () => within(screen.getByRole('dialog'))
const openInviteSheet = () => fireEvent.click(screen.getByRole('button', { name: t.inviteButton }))
// A member's actions live in a sheet now, opened from their row.
const openMember = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))

describe('ManageMembersContent — the Members tab', () => {
  it('leads with the team and lists both pending invites and members', async () => {
    renderMembers()

    await waitFor(() => expect(screen.getByText('Ishaan Invitee')).toBeInTheDocument())
    expect(screen.getByText(t.teamEyebrow)).toBeInTheDocument()
    expect(screen.getByText(`${t.teamBits.admins(1)} · ${t.teamBits.volunteers(1)}`)).toBeInTheDocument()
    expect(screen.getByText(t.pendingInvitesTitle)).toBeInTheDocument()
    expect(screen.getByText(t.waitingCount(1))).toBeInTheDocument()
    expect(screen.getByText('Amit Admin')).toBeInTheDocument()
    expect(screen.getByText('Vera Volunteer')).toBeInTheDocument()
  })

  it('narrows visible rows with the filter pills', async () => {
    renderMembers()
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: `${t.filterVolunteers} 1` }))

    expect(screen.queryByText('Amit Admin')).not.toBeInTheDocument()
    expect(screen.getByText('Vera Volunteer')).toBeInTheDocument()
    // The pending invite (role: volunteer) still matches this filter.
    expect(screen.getByText('Ishaan Invitee')).toBeInTheDocument()
  })

  it('searches name, email and phone digits', async () => {
    renderMembers()
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())
    const search = screen.getByRole('searchbox')

    fireEvent.change(search, { target: { value: 'amit@' } })
    expect(screen.getByText('Amit Admin')).toBeInTheDocument()
    expect(screen.queryByText('Vera Volunteer')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '98765' } })
    expect(screen.getByText('Vera Volunteer')).toBeInTheDocument()
    expect(screen.queryByText('Amit Admin')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText(t.noneMatch)).toBeInTheDocument()
  })

  it('hides the Admin role option in the invite sheet for a plain admin', async () => {
    setViewer(adminViewer)
    renderMembers()
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())

    openInviteSheet()
    expect(dialog().getByRole('button', { name: t.roleVolunteer })).toBeInTheDocument()
    // create_invite only lets an owner mint an admin invite.
    expect(dialog().queryByRole('button', { name: t.roleAdmin })).not.toBeInTheDocument()
  })

  it('offers the Admin role option in the invite sheet for the owner', async () => {
    renderMembers() // default viewer is owner
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())

    openInviteSheet()
    expect(dialog().getByRole('button', { name: t.roleAdmin })).toBeInTheDocument()
    expect(dialog().getByRole('button', { name: t.roleVolunteer })).toBeInTheDocument()
  })

  it('submits the invite, calls create_invite with the right args, and shows both halves', async () => {
    renderMembers()
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())

    openInviteSheet()
    fireEvent.click(dialog().getByRole('button', { name: t.roleAdmin }))
    fireEvent.change(dialog().getByLabelText(t.nameLabel), { target: { value: 'New Admin Person' } })
    fireEvent.change(dialog().getByLabelText(t.emailLabel), { target: { value: 'newadmin@example.com' } })
    fireEvent.click(dialog().getByRole('button', { name: t.sendButton }))

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_invite', {
        role: 'admin',
        name: 'New Admin Person',
        email: 'newadmin@example.com',
        phone: undefined,
      }),
    )
    await waitFor(() => expect(screen.getByText(/\/join\/tok-abc123$/)).toBeInTheDocument())
    expect(screen.getByText(t.copyLink)).toBeInTheDocument()
    expect(screen.getByText(t.shareWhatsApp)).toBeInTheDocument()
    // The typeable half, grouped for reading aloud — the whole reason it exists
    // is that the link above cannot be dictated over a phone.
    expect(screen.getByText('K7M29-XPQ4R')).toBeInTheDocument()
  })

  it('keeps the invite submit inert until a name and an email are both present', async () => {
    renderMembers()
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())
    openInviteSheet()

    const submit = () => dialog().getByRole('button', { name: t.sendButton })
    expect(submit()).toBeDisabled()
    fireEvent.change(dialog().getByLabelText(t.nameLabel), { target: { value: 'Someone' } })
    expect(submit()).toBeDisabled()
    // create_invite requires an email — it is how a joiner is recognised when
    // they sign in without the link.
    fireEvent.change(dialog().getByLabelText(t.emailLabel), { target: { value: 'someone@example.com' } })
    expect(submit()).toBeEnabled()
  })

  it("gives a plain admin the volunteer's deactivate but no controls on an admin", async () => {
    setViewer(adminViewer)
    renderMembers()
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())

    openMember('Amit Admin')
    expect(dialog().queryByRole('button', { name: t.makeVolunteer })).not.toBeInTheDocument()
    expect(dialog().queryByRole('button', { name: t.makeOwner })).not.toBeInTheDocument()
    expect(dialog().queryByRole('button', { name: t.deactivate })).not.toBeInTheDocument()
    fireEvent.click(dialog().getByRole('button', { name: strings.app.close }))

    openMember('Vera Volunteer')
    expect(dialog().getByRole('button', { name: t.deactivate })).toBeInTheDocument()
  })

  it('lets the owner change role and transfer ownership from an admin row', async () => {
    renderMembers() // default viewer is owner
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())

    openMember('Amit Admin')
    expect(dialog().getByRole('button', { name: t.makeVolunteer })).toBeInTheDocument()
    expect(dialog().getByRole('button', { name: t.makeOwner })).toBeInTheDocument()
  })

  it("says the owner's own row cannot be changed from itself", async () => {
    membersRef.current = [ownerViewer, volunteerRow]
    renderMembers()
    await waitFor(() => expect(screen.getByText('Ollie Owner')).toBeInTheDocument())

    openMember('Ollie Owner')
    expect(dialog().getByText(t.ownerRowNote)).toBeInTheDocument()
    expect(dialog().queryByRole('button', { name: t.deactivate })).not.toBeInTheDocument()
  })

  it('promotes a volunteer to admin through set_member_role', async () => {
    renderMembers()
    await waitFor(() => expect(screen.getByText('Vera Volunteer')).toBeInTheDocument())

    openMember('Vera Volunteer')
    fireEvent.click(dialog().getByRole('button', { name: t.makeAdmin }))

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_member_role', { member_id: 'user-vol-1', new_role: 'admin' }),
    )
  })

  it('shows the new link in the same ready-to-share UI after resending an invite', async () => {
    renderMembers()
    await waitFor(() => expect(screen.getByText('Ishaan Invitee')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Ishaan Invitee/ }))
    fireEvent.click(dialog().getByRole('button', { name: t.resendLong }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('resend_invite', { invite_id: 'invite-1' }))
    await waitFor(() => expect(screen.getByText(/\/join\/tok-resend-999$/)).toBeInTheDocument())
    expect(screen.getByText(t.copyLink)).toBeInTheDocument()
    // A resend supersedes BOTH halves — showing the old code would send someone
    // off to type a value the server has just revoked.
    expect(screen.getByText('B4TXW-8ZDNH')).toBeInTheDocument()
  })

  it('excludes a member row belonging to a different mandal from the list', async () => {
    const foreignMandalRow = makeUser({
      id: 'user-foreign',
      role: 'admin',
      name: 'Foreign Admin',
      mandal_id: '22222222-2222-2222-2222-000000000002',
    })
    membersRef.current = [adminRow, volunteerRow, foreignMandalRow]
    renderMembers()

    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())
    expect(screen.getByText('Vera Volunteer')).toBeInTheDocument()
    expect(screen.queryByText('Foreign Admin')).not.toBeInTheDocument()
  })

  it('confirming the revoke dialog calls revoke_invite', async () => {
    renderMembers()
    await waitFor(() => expect(screen.getByText('Ishaan Invitee')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Ishaan Invitee/ }))
    fireEvent.click(dialog().getByRole('button', { name: t.revokeButton }))
    // One modal at a time: the detail sheet closes as the confirm opens.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(dialog().getByRole('button', { name: t.revokeConfirm }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('revoke_invite', { invite_id: 'invite-1' }))
  })

  it('confirming the deactivate dialog calls deactivate_member', async () => {
    renderMembers() // owner viewer, so the volunteer's deactivate is available
    await waitFor(() => expect(screen.getByText('Vera Volunteer')).toBeInTheDocument())

    openMember('Vera Volunteer')
    fireEvent.click(dialog().getByRole('button', { name: t.deactivate }))
    fireEvent.click(dialog().getByRole('button', { name: t.deactivateConfirm }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('deactivate_member', { member_id: 'user-vol-1' }))
  })

  it('reactivates a deactivated member', async () => {
    membersRef.current = [makeUser({ ...volunteerRow, active: false })]
    renderMembers()
    await waitFor(() => expect(screen.getByText('Vera Volunteer')).toBeInTheDocument())

    openMember('Vera Volunteer')
    fireEvent.click(dialog().getByRole('button', { name: t.reactivate }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('reactivate_member', { member_id: 'user-vol-1' }))
  })
})
