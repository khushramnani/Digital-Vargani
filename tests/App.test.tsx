import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../src/app/App'
import { strings } from '../src/lib/strings'

// App renders AuthProvider unconditionally, which needs a Supabase client.
// No live project exists yet (and none of the routes exercised by this test
// require a session), so mock the client rather than requiring real env
// vars just to render the home route. vi.mock is hoisted above the imports
// above, so `App` resolves against this mock.
vi.mock('../src/lib/db/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}))

describe('App', () => {
  it('renders the app shell home route', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: strings.appName })).toBeInTheDocument()
    expect(screen.getByText(strings.appTagline)).toBeInTheDocument()
  })
})
