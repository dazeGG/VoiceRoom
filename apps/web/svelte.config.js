import adapter from '@sveltejs/adapter-static';

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
        'connect-src': ['self', 'ws:', 'wss:', 'stun:', 'turn:', 'turns:'],
        'default-src': ['self'],
        'font-src': ['self'],
        'form-action': ['none'],
        'frame-ancestors': ['none'],
        'img-src': ['self', 'data:'],
        'media-src': ['self', 'blob:'],
        'object-src': ['none'],
        'script-src': ['self', 'wasm-unsafe-eval'],
        'style-src': ['self', 'unsafe-inline']
      }
    }
  }
};

export default config;
