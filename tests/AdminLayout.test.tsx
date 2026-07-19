import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AdminLayout } from '../src/features/admin/AdminLayout'

// The console frame (desktop rail + mobile pill header + Collect FAB) moved out
// of MasterLedger into AdminLayout, so the nav assertions that used to live in
// MasterLedger.test.tsx live here. AdminLayout reads no session (sign-out only
// fires on click), so no useAuth mock is needed — just a router with an Outlet.
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<div>Dashboard body</div>} />
          <Route path="/admin/collections" element={<div>Collections body</div>} />
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

  it('offers Collect donation as a one-tap action (desktop rail + mobile FAB), pointing at /collect', () => {
    renderAt('/admin')
    const links = screen.getAllByRole('link', { name: /Collect donation/ })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toHaveAttribute('href', '/collect')
  })

  it('links to the admin management screen', () => {
    renderAt('/admin')
    const links = screen.getAllByRole('link', { name: 'Manage admins' })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toHaveAttribute('href', '/admin/admins')
  })

  it('marks the current section active (aria-current) so the console shows where you are', () => {
    renderAt('/admin/collections')
    const links = screen.getAllByRole('link', { name: 'All collections' })
    expect(links.length).toBeGreaterThan(0)
    // Both the rail item and the mobile pill for the active section carry it.
    for (const link of links) expect(link).toHaveAttribute('aria-current', 'page')
  })
})
