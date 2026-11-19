import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { NodePackageImporter } from 'sass';
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [vue()],
  css: { preprocessorOptions: { scss: { importers: [new NodePackageImporter()] } } },
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 15180, strictPort: true }
});
