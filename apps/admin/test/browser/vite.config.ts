import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { NodePackageImporter } from 'sass';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), vue()],
  css: { preprocessorOptions: { scss: { importers: [new NodePackageImporter(root)] } } },
  server: { host: '127.0.0.1', port: 15181, strictPort: true }
});
