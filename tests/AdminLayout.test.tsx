import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AdminLayout } from '../src/features/admin/AdminLayout'

// The console frame (sticky header, pill tab row, Collect FAB, Menu sheet) lives
// in AdminLayout, so the nav assertions that used to live in MasterLedger's test
// live here. AdminLayout reads no session (sign-out only fires on click) — just
// a router with an Outlet is enough. AnonUpgradeBanner does read useAuth, so it
// is mocked away; it has its own coverage.
vi.mock('../src/components/AnonUpgradeBanner', () => ({ AnonUpgradeBanner: () => null }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<div>Dashboard body</div>} />
          <Route path="/admin/collections" element={<div>Collections body</div>} />
          <Route path="/admin/donors" element={<div>Donors body</div>} />
          <Route path="/admin/handovers" element={<div>Handovers body</div>} />
          <Route path="/admin/settings" element={<div>Settings body</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminLayout', () => {
  it('renders the active section page through its Outlet', () => {
    renderAt('/admin')
    expect(screen.getByText('Dashboard body')).toBeInTheDocument()
  })

  it('offers Collect as a one-tap action from anywhere, pointing at /collect', () => {
    renderAt('/admin')
    expect(screen.getByRole('link', { name: 'Collect' })).toHaveAttribute('href', '/collect')
  })

  it('hides the Collect FAB on Settings, where the save bar owns that corner', () => {
    renderAt('/admin/settings')
    expect(screen.queryByRole('link', { name: 'Collect' })).not.toBeInTheDocument()
  })

  it('keeps every section URL stable behind the pill row', () => {
    renderAt('/admin')
    const expected: [string, string][] = [
      ['Overview', '/admin'],
      ['Collections & donors', '/admin/collections'],
      ['Expenses', '/admin/expenses'],
      ['Cash in hand', '/admin/cash-in-hand'],
      ['Members', '/admin/members'],
      ['Report', '/admin/transparency'],
      ['Settings', '/admin/settings'],
    ]
    for (const [label, href] of expected) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
    }
  })

  it('marks the current section active (aria-current) so the console shows where you are', () => {
    renderAt('/admin/collections')
    expect(screen.getByRole('link', { name: 'Collections & donors' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
  })

  it('keeps /admin/donors working as a deep link and lights the Collections tab for it', () => {
    renderAt('/admin/donors')
    expect(screen.getByText('Donors body')).toBeInTheDocument()
    // The design merges donors into the Collections tab; the URL survives.
    expect(screen.getByRole('link', { name: 'Collections & donors' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps /admin/handovers working and lights the Cash tab for it', () => {
    renderAt('/admin/handovers')
    expect(screen.getByText('Handovers body')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cash in hand' })).toHaveAttribute('aria-current', 'page')
  })

  it('titles the screen after the active section', () => {
    renderAt('/admin')
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    renderAt('/admin/collections')
    expect(screen.getByText('Collections')).toBeInTheDocument()
  })

  it('puts the sections the tab row cannot hold, and sign out, behind Menu', () => {
    renderAt('/admin')
    // Nothing menu-only is on screen until the sheet is opened.
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

    expect(screen.getByRole('heading', { name: 'More sections' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pending sends' })).toHaveAttribute('href', '/collect/pending')
    expect(screen.getByRole('link', { name: 'Log a handover' })).toHaveAttribute('href', '/admin/handovers')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
