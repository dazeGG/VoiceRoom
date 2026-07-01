import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_DEV_API_TARGET || 'http://localhost:3000';
const DEV_HOST = process.env.VITE_DEV_HOST || '127.0.0.1';
// Own a dedicated dev port instead of Vite's shared default 5173: a different
// vite-plugin-pwa project (VideoCall) registers a service worker scoped to
// localhost:5173 that then hijacks any app served on that origin. A unique
// port keeps VoiceRoom isolated from foreign service workers.
const DEV_PORT = Number(process.env.VITE_DEV_PORT) || 5180;

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: DEV_HOST,
    port: DEV_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        // Keep the browser-facing Host so the API same-origin guard can
        // compare cookie-authenticated writes against the real page Origin.
        changeOrigin: false,
        ws: true
      }
    }
  }
});
