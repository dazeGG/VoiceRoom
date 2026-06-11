import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const API_TARGET = 'http://localhost:3000';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        download: fileURLToPath(new URL('./download.html', import.meta.url))
      }
    }
  },
  server: {
    proxy: {
      '/rooms': API_TARGET,
      '/events': API_TARGET,
      '/state': API_TARGET,
      '/livekit-token': API_TARGET,
      '/pow-challenge': API_TARGET,
      '/healthz': API_TARGET
    }
  }
});
