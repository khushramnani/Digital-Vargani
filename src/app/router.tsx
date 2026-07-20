import { Routes, Route, Navigate } from 'react-router-dom'
import { LandingPage } from '../features/landing/LandingPage'
import { AdminLogin } from '../features/auth/AdminLogin'
import { InviteRedeem } from '../features/auth/InviteRedeem'
import { Signup } from '../features/auth/Signup'
import { RequireRole } from '../features/auth/RequireRole'
import { AdminLayout } from '../features/admin/AdminLayout'
import { VolunteersContent } from '../features/settings/volunteers'
import { AdminsContent } from '../features/settings/admins'
import { MandalConfigContent } from '../features/settings/MandalConfig'
import { CollectionForm } from '../features/collection/CollectionForm'
import { PendingSend } from '../features/collection/PendingSend'
import { CollectionsScreen, CollectionsContent } from '../features/collection/Collections'
import { ReceiptPage } from '../features/receipt/ReceiptPage'
import { ExpensesScreen, ExpensesContent } from '../features/expenses/ExpensesScreen'
import { HandoverScreen, HandoverContent } from '../features/cashinhand/handover'
import { CashInHandScreen, CashInHandContent } from '../features/cashinhand/CashInHand'
import { MasterLedgerContent } from '../features/ledger/MasterLedger'
import { DonorsContent } from '../features/donors/Donors'
import { PublicTransparency } from '../features/transparency/PublicTransparency'
import { AdminTransparencyContent } from '../features/transparency/AdminTransparency'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AdminLogin />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/invite/:token" element={<InviteRedeem />} />
      {/* Public, unauthenticated — donor-facing receipt, no RequireRole guard. */}
      <Route path="/r/:public_token" element={<ReceiptPage />} />
      {/* Public, unauthenticated — community transparency report, no RequireRole guard. */}
      <Route path="/transparency/:slug" element={<PublicTransparency />} />

      {/* The treasurer console: ONE persistent AdminLayout (dark rail on
          desktop, sticky pill header + Collect FAB on mobile) with the section
          pages swapped through its <Outlet/>. The role guard wraps the layout
          once; every child route inherits it. This is the "make it one app"
          fix — the console no longer lives on only the dashboard. */}
      <Route
        element={
          <RequireRole role={['owner', 'admin']}>
            <AdminLayout />
          </RequireRole>
        }
      >
        <Route path="/admin" element={<MasterLedgerContent />} />
        <Route path="/admin/collections" element={<CollectionsContent />} />
        <Route path="/admin/donors" element={<DonorsContent />} />
        <Route path="/admin/expenses" element={<ExpensesContent />} />
        <Route path="/admin/handovers" element={<HandoverContent />} />
        <Route path="/admin/cash-in-hand" element={<CashInHandContent />} />
        <Route path="/admin/volunteers" element={<VolunteersContent />} />
        <Route path="/admin/admins" element={<AdminsContent />} />
        <Route path="/admin/transparency" element={<AdminTransparencyContent />} />
        <Route path="/admin/settings" element={<MandalConfigContent />} />
      </Route>

      {/* Role-neutral collection flow: both an admin and a volunteer collect
          money the same way, so the route encodes the task, not the role
          (audit 2026-07-18 #q2). Kept OUTSIDE the console — it has its own
          AppShell + volunteer tab bar, so volunteers never see the admin rail.
          /volunteer/* below stay as redirects for old links (invite emails,
          bookmarks). */}
      <Route
        path="/collect"
        element={
          <RequireRole role={['owner', 'admin', 'volunteer']}>
            <CollectionForm />
          </RequireRole>
        }
      />
      <Route
        path="/collect/pending"
        element={
          <RequireRole role={['owner', 'admin', 'volunteer']}>
            <PendingSend />
          </RequireRole>
        }
      />
      <Route
        path="/collect/history"
        element={
          <RequireRole role={['owner', 'admin', 'volunteer']}>
            <CollectionsScreen />
          </RequireRole>
        }
      />
      <Route path="/volunteer" element={<Navigate to="/collect" replace />} />
      <Route path="/volunteer/pending" element={<Navigate to="/collect/pending" replace />} />
      <Route path="/volunteer/collections" element={<Navigate to="/collect/history" replace />} />
      <Route
        path="/volunteer/expenses"
        element={
          <RequireRole role="volunteer">
            <ExpensesScreen />
          </RequireRole>
        }
      />
      <Route
        path="/volunteer/handover"
        element={
          <RequireRole role="volunteer">
            <HandoverScreen />
          </RequireRole>
        }
      />
      <Route
        path="/volunteer/cash-in-hand"
        element={
          <RequireRole role="volunteer">
            <CashInHandScreen />
          </RequireRole>
        }
      />
    </Routes>
  )
}
