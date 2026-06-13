import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const API_TARGET = 'http://localhost:3000';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      '/api': API_TARGET
    }
  }
});
