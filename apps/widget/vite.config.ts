import { fileURLToPath } from 'node:url';
import { NodePackageImporter } from 'sass';
import { voiceAssetUrls } from '@voiceroom/call/voice-assets';
import vue from '@vitejs/plugin-vue';
import { build, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { cspMetaPlugin } from '../../scripts/build/csp-meta.ts';
import { precompressPlugin } from '../../scripts/build/precompress.ts';
import { voiceAssetsPlugin, voiceAssetVersion } from '../../scripts/build/voice-assets.ts';

const root = import.meta.dirname;
const frameHtml = '/embed/v1/index.html';
const loaderUrl = '/widget/v1/loader.js';
const loaderEntry = '/src/loader-entry.ts';
const apiProxy = {
  '/api': { target: process.env.VITE_DEV_API_TARGET || 'http://localhost:3000', changeOrigin: false, ws: true }
};

function widgetEntries(): Plugin {
  return {
    name: 'voiceroom-widget-entries',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === '/embed/v1' || request.url === '/embed/v1/') request.url = frameHtml;
        if (request.url !== loaderUrl) {
          next();
          return;
        }
        server
          .transformRequest(loaderEntry)
          .then((result) => {
            if (!result) {
              next();
              return;
            }
            response.setHeader('Content-Type', 'text/javascript');
            response.end(result.code);
          })
          .catch(next);
      });
    },
    async generateBundle() {
      // A public, independently loaded module: even when the iframe uses the
      // same dependencies, third-party parents fetch only the stable URL.
      const result = await build({
        configFile: false,
        root,
        logLevel: 'warn',
        build: {
          write: false,
          lib: { entry: fileURLToPath(new URL(`.${loaderEntry}`, import.meta.url)), formats: ['es'] }
        }
      });
      const outputs = Array.isArray(result) ? result : [result];
      const [chunk, ...extra] = outputs.flatMap((output) => ('output' in output ? output.output : []));
      if (chunk?.type !== 'chunk' || extra.length || chunk.imports.length || chunk.dynamicImports.length) {
        throw new Error('The public widget loader must be a self-contained module');
      }
      this.emitFile({ type: 'asset', fileName: loaderUrl.slice(1), source: chunk.code });
    }
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    voiceAssetsPlugin(),
    widgetEntries(),
    precompressPlugin(),
    command === 'build' &&
      cspMetaPlugin({
        'base-uri': ['none'],
        'connect-src': ['self', 'https:', 'ws:', 'wss:', 'stun:', 'turn:', 'turns:'],
        'default-src': ['self'],
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
  server: {
    host: process.env.VITE_DEV_HOST || '127.0.0.1',
    port: Number(process.env.VITE_WIDGET_DEV_PORT) || 5182,
    strictPort: true,
    proxy: apiProxy
  },
  css: { preprocessorOptions: { scss: { importers: [new NodePackageImporter(root)] } } },
  build: {
    assetsDir: '_app/immutable/widget',
    rollupOptions: { input: fileURLToPath(new URL(`.${frameHtml}`, import.meta.url)) }
  },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'], setupFiles: ['test/setup.ts'], unstubGlobals: true }
}));
