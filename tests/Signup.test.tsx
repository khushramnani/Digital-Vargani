import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Signup } from '../src/features/auth/Signup'
import { readStashedInvite } from '../src/features/auth/inviteStash'
import { strings } from '../src/lib/strings'

const c = strings.signupChoice

const { createMandal, myPendingInvites, refreshAppUser, navigate, useAuthMock } = vi.hoisted(() => ({
  createMandal: vi.fn(),
  myPendingInvites: vi.fn(),
  refreshAppUser: vi.fn(),
  navigate: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../src/lib/db/mandals', () => ({ createMandal }))
vi.mock('../src/lib/db/members', () => ({ myPendingInvites }))
vi.mock('../src/features/auth/useAuth', () => ({ useAuth: () => useAuthMock() }))
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}))

const SIGNED_IN = { session: { user: { id: 'auth-1', email: 'priya@example.com' } }, appUser: null, loading: false, refreshAppUser }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAuthMock.mockReturnValue(SIGNED_IN)
  // No invite waiting is the default; the interjection has its own test.
  myPendingInvites.mockResolvedValue([])
})

// /signup opens on a fork now (create vs. "I was invited"), so every test
// clicks into the create form before touching its fields.
function renderCreateForm() {
  render(
    <MemoryRouter>
      <Signup />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Create a mandal/ }))
}

// F7 (v4): city + state are now two visible fields sharing one assist layer.
// Typing a city and picking the suggestion fills BOTH — the visible State field
// included — before submit.
function fillAndSubmit(mandalName: string, adminName: string, opts: { slug?: string; city?: string; state?: string } = {}) {
  const city = opts.city ?? 'Mumbai'
  const state = opts.state ?? 'Maharashtra'
  fireEvent.change(screen.getByLabelText('Mandal name'), { target: { value: mandalName } })
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: adminName } })
  fireEvent.change(screen.getByLabelText('City'), { target: { value: city } })
  fireEvent.click(screen.getByText(`${city}, ${state}`))
  if (opts.slug !== undefined) {
    fireEvent.change(screen.getByLabelText(/Public link/), { target: { value: opts.slug } })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Create my mandal' }))
}

describe('Signup', () => {
  it('creates the mandal, refreshes the session user, and lands on the admin dashboard', async () => {
    createMandal.mockResolvedValue('11111111-1111-1111-1111-000000000001')
    renderCreateForm()

    fillAndSubmit('Shivaji Nagar Mandal', 'New Founder', { slug: 'shivaji-nagar' })

    await waitFor(() =>
      expect(createMandal).toHaveBeenCalledWith('Shivaji Nagar Mandal', 'New Founder', {
        slugHint: 'shivaji-nagar',
        state: 'Maharashtra',
        address: undefined,
        city: 'Mumbai',
      }),
    )
    // refreshAppUser must run before navigating: RequireRole reads appUser,
    // which is still null until the just-created users row is re-fetched.
    await waitFor(() => expect(refreshAppUser).toHaveBeenCalled())
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin', { replace: true }))
  })

  // A blank field must reach the RPC as undefined so its `default null`
  // applies and the server derives the slug from the name instead.
  it('passes undefined for a blank public link', async () => {
    createMandal.mockResolvedValue('11111111-1111-1111-1111-000000000001')
    renderCreateForm()

    fillAndSubmit('गणेश मंडळ', 'New Founder')

    await waitFor(() =>
      expect(createMandal).toHaveBeenCalledWith('गणेश मंडळ', 'New Founder', {
        slugHint: undefined,
        state: 'Maharashtra',
        address: undefined,
        city: 'Mumbai',
      }),
    )
  })

  it('fills both city and the visible state field from one typeahead pick', async () => {
    createMandal.mockResolvedValue('11111111-1111-1111-1111-000000000001')
    renderCreateForm()

    fireEvent.change(screen.getByLabelText('Mandal name'), { target: { value: 'Baroda Mandal' } })
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'New Founder' } })
    // Vadodara resolves to Gujarat — the pick fills the visible State field too.
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Vadodara' } })
    fireEvent.click(screen.getByText('Vadodara, Gujarat'))
    expect(screen.getByLabelText('State')).toHaveValue('Gujarat')
    fireEvent.click(screen.getByRole('button', { name: 'Create my mandal' }))

    await waitFor(() =>
      expect(createMandal).toHaveBeenCalledWith('Baroda Mandal', 'New Founder', {
        slugHint: undefined,
        state: 'Gujarat',
        address: undefined,
        city: 'Vadodara',
      }),
    )
  })

  it('previews the public transparency URL the chosen link will produce', async () => {
    renderCreateForm()

    fireEvent.change(screen.getByLabelText(/Public link/), { target: { value: 'Shivaji Nagar!' } })

    expect(screen.getByText('/transparency/shivaji-nagar')).toBeInTheDocument()
  })

  it('shows the database error verbatim when the account already has a mandal', async () => {
    createMandal.mockRejectedValue(new Error('this account already belongs to a mandal'))
    renderCreateForm()

    fillAndSubmit('Second Mandal', 'New Founder')

    expect(await screen.findByRole('alert')).toHaveTextContent('this account already belongs to a mandal')
    expect(navigate).not.toHaveBeenCalled()
  })


  // /signup is PUBLIC as of v6 — it's what "Sign up" on the landing page
  // points at, so the fork has to work before anyone has signed in.
  describe('without a session', () => {
    beforeEach(() => useAuthMock.mockReturnValue({ session: null, appUser: null, loading: false, refreshAppUser }))

    it('offers both doors and asks for sign-in only after one is chosen', () => {
      render(
        <MemoryRouter>
          <Signup />
        </MemoryRouter>,
      )
      expect(screen.getByText(c.createTitle)).toBeInTheDocument()
      expect(screen.getByText(c.invitedTitle)).toBeInTheDocument()
      // Nothing about signing in until they've said which one they are.
      expect(screen.queryByText('Continue with Google')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Create a mandal/ }))
      expect(screen.getByText('Continue with Google')).toBeInTheDocument()
    })

    it('takes an invite code without making anyone sign in first', async () => {
      render(
        <MemoryRouter>
          <Signup />
        </MemoryRouter>,
      )
      fireEvent.click(screen.getByRole('button', { name: /Join my mandal/ }))
      // Typed the way a human will: lowercase, with the display dash.
      fireEvent.change(screen.getByLabelText(c.codeToggle), { target: { value: 'k7m29-xpq4r' } })
      fireEvent.click(screen.getByRole('button', { name: c.codeGo }))

      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/join/K7M29XPQ4R'))
      // Stashed too, so a redirect that comes back to the wrong URL still
      // finds its way to the join.
      expect(readStashedInvite()).toBe('K7M29XPQ4R')
    })

    it('pulls the token out of a pasted invite link, since the box invites that', async () => {
      render(
        <MemoryRouter>
          <Signup />
        </MemoryRouter>,
      )
      fireEvent.click(screen.getByRole('button', { name: /Join my mandal/ }))
      fireEvent.change(screen.getByLabelText(c.codeToggle), {
        target: { value: 'https://vm.app/join/K7M29XPQ4R' },
      })
      fireEvent.click(screen.getByRole('button', { name: c.codeGo }))
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/join/K7M29XPQ4R'))
    })
  })

  // The duplicate-mandal guard. An invited person taps the first card because
  // it is first, and would otherwise found an empty second mandal while their
  // real one sits waiting.
  it('offers a waiting invite before letting an invited person create a mandal', async () => {
    myPendingInvites.mockResolvedValue([
      { code: 'K7M29XPQ4R', mandalName: 'Ganesh Mandal', role: 'volunteer', invitee: 'Priya' },
    ])
    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Create a mandal/ }))

    await waitFor(() => expect(screen.getByText(c.interjectTitle)).toBeInTheDocument())
    expect(screen.queryByLabelText('Mandal name')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: c.interjectJoin('Ganesh Mandal') }))
    expect(navigate).toHaveBeenCalledWith('/continue')
  })

  it('still lets them create one anyway if that is genuinely what they meant', async () => {
    myPendingInvites.mockResolvedValue([
      { code: 'K7M29XPQ4R', mandalName: 'Ganesh Mandal', role: 'volunteer', invitee: 'Priya' },
    ])
    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Create a mandal/ }))
    await waitFor(() => expect(screen.getByText(c.interjectTitle)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: c.interjectCreate }))
    expect(screen.getByLabelText('Mandal name')).toBeInTheDocument()
  })

  // /continue sends them here after signing in found no invite for their
  // address. Saying which address missed is the difference between a dead
  // end and something they can act on.
  it('names the address that found no invite, and drops straight to the code box', () => {
    render(
      <MemoryRouter initialEntries={['/signup?nomatch=priya.shah%40example.com']}>
        <Signup />
      </MemoryRouter>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('priya.shah@example.com')
    expect(screen.getByLabelText(c.codeLabel)).toBeInTheDocument()
    // Re-offering Google here would just loop them through the same failed
    // match — the code is the only thing left that can help.
    expect(screen.queryByText('Continue with Google')).not.toBeInTheDocument()
  })
})

