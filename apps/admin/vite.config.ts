import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The admin app on its own dev port; /api goes to the API as on the main site.
const API_TARGET = process.env.VITE_DEV_API_TARGET || 'http://localhost:3000';
const DEV_HOST = process.env.VITE_DEV_HOST || '127.0.0.1';
const DEV_PORT = Number(process.env.VITE_DEV_PORT) || 5181;

export default defineConfig({
  plugins: [react()],
  server: {
    host: DEV_HOST,
    port: DEV_PORT,
    strictPort: true,
    // The browser-facing Host is kept so the API's same-origin check compares
    // the admin app's writes against its own origin.
    proxy: { '/api': { target: API_TARGET, changeOrigin: false } }
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'jsdom',
    testTimeout: 20000,
    unstubGlobals: true
  }
});
