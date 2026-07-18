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
        name: 'Digital Vargani',
        short_name: 'Vargani',
        description: 'Digital Vargani & Fund Management System',
        theme_color: '#c2410c',
        background_color: '#ffffff',
        display: 'standalone',
        // 'any' and 'maskable' are split into separate entries: a maskable
        // icon is authored with safe-zone padding and looks shrunken when the
        // OS renders it un-masked, so a single 'any maskable' entry is an
        // anti-pattern (audit 2026-07-18 #14).
        // ponytail: still SVG-only — no raster toolchain in this env to emit
        // the 192/512 PNGs iOS/older Androids prefer; add real PNGs (+ an
        // apple-touch-icon <link> in index.html) when generating assets.
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
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
