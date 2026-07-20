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
const { getSession, onAuthStateChange, rpc, from, maybeSingle, membersRef, invitesRef } = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const membersRef: { current: unknown[] } = { current: [] }
  const invitesRef: { current: unknown[] } = { current: [] }
  const chain: {
    eq: () => typeof chain
    order: () => typeof chain
    limit: () => typeof chain
    maybeSingle: typeof maybeSingle
    then: (resolve: (v: { data: unknown; error: null }) => void) => void
  } = {
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle,
    then: (resolve) => resolve({ data: membersRef.current, error: null }),
  }
  return {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    rpc: vi.fn(),
    from: vi.fn(() => ({ select: () => chain })),
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
    if (fn === 'create_invite') return Promise.resolve({ data: 'tok-abc123', error: null })
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

async function openInviteSheet() {
  fireEvent.click(screen.getByRole('button', { name: t.inviteButton }))
  return screen.getByRole('dialog')
}

describe('ManageMembersContent', () => {
  it('renders both a pending invite row and active member rows', async () => {
    renderMembers()

    await waitFor(() => expect(screen.getByText('Ishaan Invitee')).toBeInTheDocument())
    expect(screen.getByText('Amit Admin')).toBeInTheDocument()
    expect(screen.getByText('Vera Volunteer')).toBeInTheDocument()
    expect(screen.getByText(t.statusInvited, { exact: false })).toBeInTheDocument()
    expect(screen.getAllByText(t.statusActive).length).toBeGreaterThan(0)
  })

  it('narrows visible rows with the filter chips', async () => {
    renderMembers()
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())
    expect(screen.getByText('Vera Volunteer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t.filterVolunteers }))

    expect(screen.queryByText('Amit Admin')).not.toBeInTheDocument()
    expect(screen.getByText('Vera Volunteer')).toBeInTheDocument()
    // The pending invite (role: volunteer) still matches this filter.
    expect(screen.getByText('Ishaan Invitee')).toBeInTheDocument()
  })

  it('hides the Admin role option in the invite sheet for a plain admin', async () => {
    setViewer(adminViewer)
    renderMembers()
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())

    const dialog = await openInviteSheet()
    expect(within(dialog).getByRole('button', { name: t.roleVolunteer })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: t.roleAdmin })).not.toBeInTheDocument()
  })

  it('offers the Admin role option in the invite sheet for the owner', async () => {
    renderMembers() // default viewer is owner
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())

    const dialog = await openInviteSheet()
    expect(within(dialog).getByRole('button', { name: t.roleAdmin })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: t.roleVolunteer })).toBeInTheDocument()
  })

  it('submits the invite form, calls create_invite with the right args, and shows the resulting link', async () => {
    renderMembers()
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())

    const dialog = await openInviteSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: t.roleAdmin }))
    fireEvent.change(within(dialog).getByLabelText(t.nameLabel), { target: { value: 'New Admin Person' } })
    fireEvent.change(within(dialog).getByLabelText(t.emailLabel), { target: { value: 'newadmin@example.com' } })
    fireEvent.click(within(dialog).getByRole('button', { name: t.sendButton }))

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_invite', {
        role: 'admin',
        name: 'New Admin Person',
        email: 'newadmin@example.com',
        phone: undefined,
      }),
    )
    await waitFor(() => expect(screen.getByDisplayValue(/\/join\/tok-abc123$/)).toBeInTheDocument())
    expect(screen.getByText(t.copyLink)).toBeInTheDocument()
    expect(screen.getByText(t.shareWhatsApp)).toBeInTheDocument()
  })

  it('lets a plain admin deactivate/reactivate a volunteer but shows no role-change/transfer controls on an admin row', async () => {
    setViewer(adminViewer)
    renderMembers()
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())

    const adminLi = screen.getByText('Amit Admin').closest('li')!
    const volunteerLi = screen.getByText('Vera Volunteer').closest('li')!

    expect(within(adminLi).queryByText(t.makeVolunteer)).not.toBeInTheDocument()
    expect(within(adminLi).queryByText(t.makeOwner)).not.toBeInTheDocument()
    expect(within(adminLi).queryByText(t.deactivate)).not.toBeInTheDocument()

    expect(within(volunteerLi).getByText(t.deactivate)).toBeInTheDocument()
  })

  it('lets the owner change role and transfer ownership from an admin row', async () => {
    renderMembers() // default viewer is owner
    await waitFor(() => expect(screen.getByText('Amit Admin')).toBeInTheDocument())

    const adminLi = screen.getByText('Amit Admin').closest('li')!
    expect(within(adminLi).getByText(t.makeVolunteer)).toBeInTheDocument()
    expect(within(adminLi).getByText(t.makeOwner)).toBeInTheDocument()
  })

  it('confirming the revoke dialog calls revoke_invite', async () => {
    renderMembers()
    await waitFor(() => expect(screen.getByText('Ishaan Invitee')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: t.revokeButton }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: t.revokeConfirm }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('revoke_invite', { invite_id: 'invite-1' }))
  })

  it('confirming the deactivate dialog calls deactivate_member', async () => {
    renderMembers() // owner viewer, so the volunteer row's deactivate is available
    await waitFor(() => expect(screen.getByText('Vera Volunteer')).toBeInTheDocument())

    const volunteerLi = screen.getByText('Vera Volunteer').closest('li')!
    fireEvent.click(within(volunteerLi).getByText(t.deactivate))

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: t.deactivateConfirm }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('deactivate_member', { member_id: 'user-vol-1' }))
  })
})
