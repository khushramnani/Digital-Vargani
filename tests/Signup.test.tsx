import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Signup } from '../src/features/auth/Signup'

const { createMandal, refreshAppUser, navigate } = vi.hoisted(() => ({
  createMandal: vi.fn(),
  refreshAppUser: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../src/lib/db/mandals', () => ({ createMandal }))
vi.mock('../src/features/auth/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: 'auth-1' } }, appUser: null, loading: false, refreshAppUser }),
}))
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}))

beforeEach(() => vi.clearAllMocks())

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
})
