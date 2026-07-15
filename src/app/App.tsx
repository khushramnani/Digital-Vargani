import { useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../features/auth/AuthProvider'
import { AppRoutes } from './router'
import { syncAllPending } from '../lib/queue/sync'

export function App() {
  // Task 10: catch up on anything queued in a previous, now-closed session
  // (reopening the app already online), and again whenever connectivity
  // comes back. .catch(() => {}) mirrors this codebase's other fire-and-
  // forget calls (e.g. send.ts's markSmsSent) — IndexedDB being unavailable
  // here shouldn't crash the whole app shell.
  useEffect(() => {
    syncAllPending().catch(() => {})
    function handleOnline() {
      syncAllPending().catch(() => {})
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
