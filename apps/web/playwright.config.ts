import { defineConfig, devices } from '@playwright/test';

// E2e targets the dev web server at baseURL. Start the full stack from the
// repo root before running (`npm run dev:up`), or wire the same command into CI.
export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	use: {
		baseURL: 'http://localhost:5180',
		trace: 'on-first-retry',
		// фейковые медиа — комната просит микрофон/WebRTC
		launchOptions: {
			args: [
				'--use-fake-device-for-media-stream',
				'--use-fake-ui-for-media-stream'
			]
		}
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
