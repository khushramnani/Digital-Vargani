import { registerSW } from 'virtual:pwa-register'

// Registers the Workbox-generated service worker so the app is installable
// and works offline. Called once from main.tsx.
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    registerSW({ immediate: true })
  }
}
