import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_DEV_API_TARGET || 'http://localhost:3000';
const DEV_HOST = process.env.VITE_DEV_HOST || '127.0.0.1';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: DEV_HOST,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: false
      }
    }
  }
});
