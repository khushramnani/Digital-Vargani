import { Routes, Route } from 'react-router-dom'
import { LandingPage } from '../features/landing/LandingPage'
import { AdminLogin } from '../features/auth/AdminLogin'
import { InviteRedeem } from '../features/auth/InviteRedeem'
import { RequireRole } from '../features/auth/RequireRole'
import { VolunteersScreen } from '../features/settings/volunteers'
import { AdminsScreen } from '../features/settings/admins'
import { MandalConfigScreen } from '../features/settings/MandalConfig'
import { CollectionForm } from '../features/collection/CollectionForm'
import { PendingSend } from '../features/collection/PendingSend'
import { CollectionsScreen } from '../features/collection/Collections'
import { ReceiptPage } from '../features/receipt/ReceiptPage'
import { ExpensesScreen } from '../features/expenses/ExpensesScreen'
import { HandoverScreen } from '../features/cashinhand/handover'
import { CashInHandScreen } from '../features/cashinhand/CashInHand'
import { MasterLedgerScreen } from '../features/ledger/MasterLedger'
import { PublicTransparency } from '../features/transparency/PublicTransparency'
import { AdminTransparency } from '../features/transparency/AdminTransparency'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AdminLogin />} />
      <Route path="/invite/:token" element={<InviteRedeem />} />
      {/* Public, unauthenticated — donor-facing receipt, no RequireRole guard. */}
      <Route path="/r/:public_token" element={<ReceiptPage />} />
      {/* Public, unauthenticated — community transparency report, no RequireRole guard. */}
      <Route path="/transparency/:slug" element={<PublicTransparency />} />
      <Route
        path="/admin"
        element={
          <RequireRole role="admin">
            <MasterLedgerScreen />
          </RequireRole>
        }
      />
      <Route
        path="/admin/volunteers"
        element={
          <RequireRole role="admin">
            <VolunteersScreen />
          </RequireRole>
        }
      />
      <Route
        path="/admin/admins"
        element={
          <RequireRole role="admin">
            <AdminsScreen />
          </RequireRole>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <RequireRole role="admin">
            <MandalConfigScreen />
          </RequireRole>
        }
      />
      <Route
        path="/volunteer"
        element={
          <RequireRole role={['admin', 'volunteer']}>
            <CollectionForm />
          </RequireRole>
        }
      />
      <Route
        path="/volunteer/pending"
        element={
          <RequireRole role={['admin', 'volunteer']}>
            <PendingSend />
          </RequireRole>
        }
      />
      <Route
        path="/volunteer/expenses"
        element={
          <RequireRole role="volunteer">
            <ExpensesScreen />
          </RequireRole>
        }
      />
      <Route
        path="/admin/expenses"
        element={
          <RequireRole role="admin">
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
        path="/admin/handovers"
        element={
          <RequireRole role="admin">
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
      <Route
        path="/admin/cash-in-hand"
        element={
          <RequireRole role="admin">
            <CashInHandScreen />
          </RequireRole>
        }
      />
      <Route
        path="/admin/transparency"
        element={
          <RequireRole role="admin">
            <AdminTransparency />
          </RequireRole>
        }
      />
      <Route
        path="/volunteer/collections"
        element={
          <RequireRole role={['admin', 'volunteer']}>
            <CollectionsScreen />
          </RequireRole>
        }
      />
      <Route
        path="/admin/collections"
        element={
          <RequireRole role="admin">
            <CollectionsScreen />
          </RequireRole>
        }
      />
    </Routes>
  )
}
