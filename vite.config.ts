/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Vinayak Mandal',
        short_name: 'Vinayak Mandal',
        description: 'Digital Vargani & Fund Management System',
        theme_color: '#c2410c',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/lib/money.ts', 'src/lib/reconcile.ts'],
      thresholds: {
        'src/lib/money.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/lib/reconcile.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
})
