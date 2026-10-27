import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

import { cspMetaPlugin, versionFilePlugin } from './scripts/deploy-contract.ts';

const API_TARGET = process.env.VITE_DEV_API_TARGET || 'http://localhost:3000';
const DEV_HOST = process.env.VITE_DEV_HOST || '127.0.0.1';
// Own a dedicated dev port instead of Vite's shared default 5173: a different
// vite-plugin-pwa project (VideoCall) registers a service worker scoped to
// localhost:5173 that then hijacks any app served on that origin. 5180 is the
// Svelte web and 5181 the admin app until the cutover.
const DEV_PORT = Number(process.env.VITE_DEV_PORT) || 5182;
const API_PROXY = {
  '/api': {
    target: API_TARGET,
    // Keep the browser-facing Host so the API same-origin guard can
    // compare cookie-authenticated writes against the real page Origin.
    changeOrigin: false,
    ws: true
  }
};

export default defineConfig({
  plugins: [vue(), cspMetaPlugin(), versionFilePlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  server: {
    host: DEV_HOST,
    port: DEV_PORT,
    strictPort: true,
    proxy: API_PROXY
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Caddy caches /_app/immutable/* for a year and keeps earlier releases'
    // chunks there for open tabs (Caddyfile, config/caddy/archive-assets.sh).
    assetsDir: '_app/immutable'
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    testTimeout: 20000,
    // vi.stubGlobal() is undone after every test.
    unstubGlobals: true
  },
  preview: {
    host: DEV_HOST,
    port: DEV_PORT,
    strictPort: true,
    proxy: API_PROXY
  }
});
