import { NodePackageImporter } from 'sass';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { configDefaults, defineConfig } from 'vitest/config';
import { voiceAssetUrls } from '@voiceroom/call/voice-assets';

import {
  buildVersion,
  cspMetaPlugin,
  precompressPlugin,
  serviceWorkerPlugin,
  versionFilePlugin,
  voiceAssetVersion,
  voiceAssetsPlugin
} from './scripts/deploy-contract.ts';

const API_TARGET = process.env.VITE_DEV_API_TARGET || 'http://localhost:3000';
const DEV_HOST = process.env.VITE_DEV_HOST || '127.0.0.1';
// Own a dedicated dev port instead of Vite's shared default 5173: a different
// vite-plugin-pwa project (VideoCall) registers a service worker scoped to
// localhost:5173 that then hijacks any app served on that origin. 5181 is the
// admin app.
const DEV_PORT = Number(process.env.VITE_DEV_PORT) || 5180;
const API_PROXY = {
  '/api': {
    target: API_TARGET,
    // Keep the browser-facing Host so the API same-origin guard can
    // compare cookie-authenticated writes against the real page Origin.
    changeOrigin: false,
    ws: true
  }
};

// One id for the bundle (the update check compares against it) and /_app/version.json.
const APP_VERSION = buildVersion();

// Suites that can run in Node. The other suites use the browser setup.
const nodeTestFiles = [
  'test/audio-gate-worklet.test.ts',
  'test/avatar-initial.test.ts',
  'test/caddy-admin-gate.test.ts',
  'test/caddy-assetlinks.test.ts',
  'test/caddy-behind-edge.test.ts',
  'test/caddy-csp.test.ts',
  'test/caddy-extra-sites.test.ts',
  'test/caddy-static-cache.test.ts',
  'test/chat-drafts.test.ts',
  'test/chat-typing.test.ts',
  'test/composer-emoji.test.ts',
  'test/composer-markdown.test.ts',
  'test/date-format.test.ts',
  'test/deploy-contract.test.ts',
  'test/desktop-audio-source-worklet.test.ts',
  'test/desktop-autostart.test.ts',
  'test/desktop-hotkey-service.test.ts',
  'test/display-name.test.ts',
  'test/dm-pagination.test.ts',
  'test/emoji-artwork.test.ts',
  'test/emoji-text.test.ts',
  'test/features/contract-violations.test.ts',
  'test/features/dm-invite-view.test.ts',
  'test/features/error-texts.test.ts',
  'test/features/friend-presence.test.ts',
  'test/features/join-timing.test.ts',
  'test/features/loss-window.test.ts',
  'test/features/notification-inbox.test.ts',
  'test/features/rnnoise-worklet.test.ts',
  'test/features/room-cta.test.ts',
  'test/features/screen-profiles.test.ts',
  'test/features/trailing-task.test.ts',
  'test/network-stats.test.ts',
  'test/new-id.test.ts',
  'test/popover-placement.test.ts',
  'test/push-localization.test.ts',
  'test/reaction-reconciliation.test.ts',
  'test/read-reconciliation.test.ts',
  'test/room-pagination.test.ts',
  'test/runtime-config.test.ts',
  'test/turn-edge.test.ts',
  'test/widget-edge.test.ts'
];

export default defineConfig({
  plugins: [
    vue(),
    cspMetaPlugin(),
    versionFilePlugin(APP_VERSION),
    serviceWorkerPlugin(),
    voiceAssetsPlugin(),
    precompressPlugin()
  ],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
    __VOICE_ASSET_URLS__: JSON.stringify(voiceAssetUrls(voiceAssetVersion()))
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  server: {
    host: DEV_HOST,
    port: DEV_PORT,
    strictPort: true,
    proxy: API_PROXY
  },
  css: { preprocessorOptions: { scss: { importers: [new NodePackageImporter()] } } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Caddy caches /_app/immutable/* for a year and keeps earlier releases'
    // chunks there for open tabs (Caddyfile, config/caddy/archive-assets.sh).
    assetsDir: '_app/immutable'
  },
  test: {
    testTimeout: 20000,
    // vi.stubGlobal() is undone after every test.
    unstubGlobals: true,
    projects: [
      {
        test: { name: 'node', environment: 'node', include: nodeTestFiles }
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...nodeTestFiles],
          setupFiles: ['test/setup.ts']
        }
      }
    ]
  },
  preview: {
    host: DEV_HOST,
    port: DEV_PORT,
    strictPort: true,
    proxy: API_PROXY
  }
});
