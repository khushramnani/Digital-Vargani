import { Routes, Route } from 'react-router-dom'
import { strings } from '../lib/strings'
import { AdminLogin } from '../features/auth/AdminLogin'
import { InviteRedeem } from '../features/auth/InviteRedeem'
import { RequireRole } from '../features/auth/RequireRole'
import { VolunteersScreen } from '../features/settings/volunteers'
import { MandalConfigScreen } from '../features/settings/MandalConfig'
import { CollectionForm } from '../features/collection/CollectionForm'
import { PendingSend } from '../features/collection/PendingSend'
import { ReceiptPage } from '../features/receipt/ReceiptPage'
import { ExpensesScreen } from '../features/expenses/ExpensesScreen'
import { HandoverScreen } from '../features/cashinhand/handover'
import { CashInHandScreen } from '../features/cashinhand/CashInHand'
import { MasterLedgerScreen } from '../features/ledger/MasterLedger'
import { PublicTransparency } from '../features/transparency/PublicTransparency'
import { AdminTransparency } from '../features/transparency/AdminTransparency'

function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-2xl font-semibold text-stone-900">{strings.appName}</h1>
      <p className="text-stone-600">{strings.appTagline}</p>
      <p className="text-sm text-stone-400">{strings.home.placeholder}</p>
    </main>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<AdminLogin />} />
      <Route path="/invite/:token" element={<InviteRedeem />} />
      {/* Public, unauthenticated — donor-facing receipt, no RequireRole guard. */}
      <Route path="/r/:public_token" element={<ReceiptPage />} />
      {/* Public, unauthenticated — community transparency report, no RequireRole guard. */}
      <Route path="/transparency" element={<PublicTransparency />} />
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
          <RequireRole role="volunteer">
            <CollectionForm />
          </RequireRole>
        }
      />
      <Route
        path="/volunteer/pending"
        element={
          <RequireRole role="volunteer">
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
    </Routes>
  )
}
