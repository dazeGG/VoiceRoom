import adapter from '@sveltejs/adapter-static';

function addOrigin(sources, value) {
  const raw = String(value || '').trim();
  if (!raw) return;

  try {
    sources.add(new URL(raw).origin);
  } catch {
    // Ignore malformed optional env values; runtime validation still happens in the API.
  }
}

function liveKitConnectSources(env = process.env) {
  const sources = new Set();

  addOrigin(sources, env.LIVEKIT_URL);
  addOrigin(sources, env.LIVEKIT_PUBLIC_URL);

  const livekitDomain = String(env.LIVEKIT_DOMAIN || '').trim();
  if (livekitDomain) sources.add(`wss://${livekitDomain}`);

  const domain = String(env.DOMAIN || '').trim();
  if (domain) sources.add(`wss://livekit.${domain}`);

  return Array.from(sources).sort();
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      assets: 'dist',
      pages: 'dist',
      fallback: 'index.html'
    }),
    csp: {
      mode: 'hash',
      directives: {
        'base-uri': ['none'],
        'connect-src': [
          'self',
          ...liveKitConnectSources(),
          'ws://localhost:*',
          'ws://127.0.0.1:*',
          'stun:',
          'turn:',
          'turns:'
        ],
        'default-src': ['self'],
        'font-src': ['self'],
        'form-action': ['none'],
        'frame-ancestors': ['none'],
        'img-src': ['self', 'data:'],
        'media-src': ['self', 'blob:'],
        'object-src': ['none'],
        'script-src': ['self', 'wasm-unsafe-eval'],
        // Kept until inline component styles are removed; SvelteKit hash mode covers
        // scripts, but current Svelte markup still emits style attributes.
        'style-src': ['self', 'unsafe-inline']
      }
    }
  }
};

export default config;
