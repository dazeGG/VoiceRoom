import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: './ui-audit-e2e',
  workers: 1,
  retries: 0,
  timeout: 20000,
  expect: { timeout: 2000 },
  use: {
    viewport: { width: 1280, height: 900 },
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'firefox', use: { browserName: 'firefox' } }
  ],
  webServer: [
    {
      command: 'node ../../node_modules/astro/bin/astro.mjs dev --host 127.0.0.1 --port 15182',
      cwd: fileURLToPath(new URL('../site', import.meta.url)),
      url: 'http://127.0.0.1:15182/',
      reuseExistingServer: false
    },
    {
      command: 'node ../../node_modules/vite/bin/vite.js --config test/browser/vite.config.ts',
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      url: 'http://127.0.0.1:15180/test/browser/',
      reuseExistingServer: false
    },
    {
      command: 'node ../../node_modules/vite/bin/vite.js --config test/browser/vite.config.ts',
      cwd: fileURLToPath(new URL('../admin', import.meta.url)),
      url: 'http://127.0.0.1:15181/test/browser/',
      reuseExistingServer: false
    }
  ]
});
