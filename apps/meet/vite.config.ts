import { fileURLToPath } from 'node:url';
import { NodePackageImporter } from 'sass';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import { voiceAssetUrls } from '@voiceroom/call/voice-assets';
import { cspMetaPlugin } from '../../scripts/build/csp-meta.ts';
import { voiceAssetsPlugin, voiceAssetVersion } from '../../scripts/build/voice-assets.ts';

export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    voiceAssetsPlugin(),
    command === 'build' &&
      cspMetaPlugin({
        'base-uri': ['none'],
        'connect-src': ['self', 'ws:', 'wss:', 'stun:', 'turn:', 'turns:'],
        'default-src': ['self'],
        'font-src': ['self'],
        'form-action': ['none'],
        'img-src': ['self', 'data:', 'blob:'],
        'media-src': ['self', 'blob:'],
        'object-src': ['none'],
        'script-src': ['self', 'wasm-unsafe-eval'],
        'style-src': ['self', 'unsafe-inline']
      })
  ],
  define: { __VOICE_ASSET_URLS__: JSON.stringify(voiceAssetUrls(voiceAssetVersion())) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  css: { preprocessorOptions: { scss: { importers: [new NodePackageImporter()] } } },
  build: { assetsDir: '_meet/immutable' },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'], unstubGlobals: true }
}));
