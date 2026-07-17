import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    // Every spec that injects a session stubs Supabase at this exact origin
    // (page.route) and writes the session to the storage key supabase-js
    // derives from it (`sb-127-auth-token`). Both are a function of
    // VITE_SUPABASE_URL, so the suite only works if the dev server agrees on
    // it — and .env.local now points at the live project, which silently
    // broke every one of those specs and pointed the suite at real data.
    // Vite lets real env vars win over .env files, so pinning it here keeps
    // the e2e run hermetic and offline by construction. The key is never
    // used: nothing reaches a real server.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'fake-anon-key-e2e-never-leaves-page-route',
    },
  },
  use: {
    baseURL: 'http://localhost:5173',
  },
})
