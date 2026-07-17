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

function fillAndSubmit(mandalName: string, adminName: string, slug?: string) {
  fireEvent.change(screen.getByLabelText('Mandal name'), { target: { value: mandalName } })
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: adminName } })
  if (slug !== undefined) {
    fireEvent.change(screen.getByLabelText('Public link (optional)'), { target: { value: slug } })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Create mandal' }))
}

describe('Signup', () => {
  it('creates the mandal, refreshes the session user, and lands on the admin dashboard', async () => {
    createMandal.mockResolvedValue('11111111-1111-1111-1111-000000000001')
    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    )

    fillAndSubmit('Shivaji Nagar Mandal', 'New Founder', 'shivaji-nagar')

    await waitFor(() =>
      expect(createMandal).toHaveBeenCalledWith('Shivaji Nagar Mandal', 'New Founder', 'shivaji-nagar'),
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
    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    )

    fillAndSubmit('गणेश मंडळ', 'New Founder')

    await waitFor(() => expect(createMandal).toHaveBeenCalledWith('गणेश मंडळ', 'New Founder', undefined))
  })

  it('previews the public transparency URL the chosen link will produce', async () => {
    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Public link (optional)'), { target: { value: 'Shivaji Nagar!' } })

    expect(screen.getByText('/transparency/shivaji-nagar')).toBeInTheDocument()
  })

  it('shows the database error verbatim when the account already has a mandal', async () => {
    createMandal.mockRejectedValue(new Error('this account already belongs to a mandal'))
    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    )

    fillAndSubmit('Second Mandal', 'New Founder')

    expect(await screen.findByRole('alert')).toHaveTextContent('this account already belongs to a mandal')
    expect(navigate).not.toHaveBeenCalled()
  })
})
