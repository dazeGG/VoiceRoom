// The public site: static pages for search engines and new visitors, built to
// dist/ and served by Caddy from /srv/site next to the app (Caddyfile).
import { defineConfig } from 'astro/config';
import { buildContract } from './src/build-contract.ts';
import { SITE_ORIGIN } from './src/site.ts';

export default defineConfig({
  site: SITE_ORIGIN,
  // /screen-sharing is screen-sharing.html: one address per page, no trailing slash.
  trailingSlash: 'never',
  build: {
    format: 'file',
    // The app owns /_app/; the site's hashed files live apart (Caddy caches both for a year).
    assets: '_astro',
    inlineStylesheets: 'never'
  },
  // Scripts stay files: the site is served under script-src 'self' (build-contract.ts).
  vite: { build: { assetsInlineLimit: 0 } },
  devToolbar: { enabled: false },
  integrations: [buildContract()]
});
