import { defineConfig } from 'vite';

const API_TARGET = 'http://localhost:3000';

export default defineConfig({
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
