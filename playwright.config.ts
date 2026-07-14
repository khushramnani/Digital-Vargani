import { defineConfig } from '@playwright/test'

// No specs yet — Task 1 scaffolds config only. Later tasks add e2e/*.spec.ts
// for their own critical flows.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:5173',
  },
})
