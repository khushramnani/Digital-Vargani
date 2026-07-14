import { Link, Routes, Route } from 'react-router-dom'
import { strings } from '../lib/strings'
import { AdminLogin } from '../features/auth/AdminLogin'
import { InviteRedeem } from '../features/auth/InviteRedeem'
import { RequireRole } from '../features/auth/RequireRole'
import { VolunteersScreen } from '../features/settings/volunteers'
import { MandalConfigScreen } from '../features/settings/MandalConfig'
import { CollectionForm } from '../features/collection/CollectionForm'

function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-2xl font-semibold text-stone-900">{strings.appName}</h1>
      <p className="text-stone-600">{strings.appTagline}</p>
      <p className="text-sm text-stone-400">{strings.home.placeholder}</p>
    </main>
  )
}

// Task 15 builds the real dashboard content; this is just something real to
// redirect to and land on for the "session -> acting user id" acceptance
// criterion.
function AdminDashboardPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-2xl font-semibold text-stone-900">{strings.admin.dashboardTitle}</h1>
      <p className="text-sm text-stone-400">{strings.admin.dashboardPlaceholder}</p>
      <Link to="/admin/volunteers" className="text-orange-700 underline">
        {strings.admin.volunteersLink}
      </Link>
      <Link to="/admin/settings" className="text-orange-700 underline">
        {strings.admin.settingsLink}
      </Link>
    </main>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<AdminLogin />} />
      <Route path="/invite/:token" element={<InviteRedeem />} />
      <Route
        path="/admin"
        element={
          <RequireRole role="admin">
            <AdminDashboardPage />
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
    </Routes>
  )
}
