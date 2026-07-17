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

// Task 10: App calls syncAllPending() on mount and on the `online` event.
// It talks to real IndexedDB via Dexie, which jsdom doesn't implement —
// mocked here the same way every other test in this file mocks exactly
// what the component itself calls, not the internals underneath it.
vi.mock('../src/lib/queue/sync', () => ({
  syncAllPending: vi.fn(() => Promise.resolve()),
}))

describe('App', () => {
  it('renders the marketing landing page at the home route', () => {
    render(<App />)
    expect(screen.getAllByText(strings.landing.productName).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(strings.landing.hero.titleHighlight)
  })
})
