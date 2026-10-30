import { defineConfig, devices } from '@playwright/test';

// E2e targets the dev web server at baseURL. Start the full stack from the
// repo root before running (`npm run dev:up`) and the Vue dev server
// (`npm --workspace @voice-room/web-vue run dev`), or wire the same commands into CI.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5182',
    trace: 'retain-on-failure',
    // фейковые медиа — комната просит микрофон/WebRTC
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--host-resolver-rules=MAP voice-gate.test 127.0.0.1'
      ]
    }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
