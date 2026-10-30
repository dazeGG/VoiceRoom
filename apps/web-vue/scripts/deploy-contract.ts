// What the build owes the deployment (Caddyfile, Dockerfile web-build stage):
// a CSP <meta> in index.html that scripts/emit-caddy-csp.ts turns into the
// Caddy header, /_app/version.json, which open tabs poll to learn of a deploy
// and show the update notice, and /service-worker.js for web push. Assets go
// to /_app/immutable/ through build.assetsDir in vite.config.ts.

import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

type Env = Record<string, string | undefined>;

function addOrigin(sources: Set<string>, value: string | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return;

  try {
    sources.add(new URL(raw).origin);
  } catch {
    // Ignore malformed optional env values; runtime validation still happens in the API.
  }
}

function liveKitConnectSources(env: Env) {
  const sources = new Set<string>();

  addOrigin(sources, env.LIVEKIT_URL);
  addOrigin(sources, env.LIVEKIT_PUBLIC_URL);

  const livekitDomain = String(env.LIVEKIT_DOMAIN || '').trim();
  if (livekitDomain) sources.add(`wss://${livekitDomain}`);

  const domain = String(env.DOMAIN || '').trim();
  if (domain) sources.add(`wss://livekit.${domain}`);

  return Array.from(sources).sort();
}

/** The page policy. The build emits no inline script, so script-src needs no hash. */
export function pageCspDirectives(env: Env = process.env): Record<string, readonly string[]> {
  return {
    'base-uri': ['none'],
    'connect-src': [
      'self',
      ...liveKitConnectSources(env),
      // The immutable web image does not know the runtime LiveKit origin.
      // Production Caddy adds a second, environment-specific CSP that
      // narrows these schemes to LIVEKIT_DOMAIN.
      'http:',
      'https:',
      'ws:',
      'wss:',
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
    // blob: serves local-only previews (avatar crop) rendered via object URLs.
    'img-src': ['self', 'data:', 'blob:'],
    'media-src': ['self', 'blob:'],
    'object-src': ['none'],
    'script-src': ['self', 'wasm-unsafe-eval'],
    // Kept while components still set style attributes (positions, sizes).
    'style-src': ['self', 'unsafe-inline']
  };
}

// CSP keywords are written in single quotes; schemes and hosts are not.
const QUOTED = new Set([
  'self',
  'unsafe-eval',
  'unsafe-hashes',
  'unsafe-inline',
  'none',
  'strict-dynamic',
  'report-sample',
  'wasm-unsafe-eval',
  'script'
]);
// A <meta> policy ignores these; Caddy sends frame-ancestors in the header.
const HEADER_ONLY = new Set(['frame-ancestors', 'report-uri', 'sandbox']);

export function metaPolicy(directives: Record<string, readonly string[]>): string {
  return Object.entries(directives)
    .filter(([name, values]) => !HEADER_ONLY.has(name) && values.length > 0)
    .map(([name, values]) => [name, ...values.map((value) => (QUOTED.has(value) ? `'${value}'` : value))].join(' '))
    .join('; ');
}

export function cspMetaPlugin(env: Env = process.env): Plugin {
  const policy = metaPolicy(pageCspDirectives(env));
  if (policy.includes('"')) throw new Error('policy cannot contain a double quote');
  return {
    name: 'voiceroom-csp-meta',
    // Written as raw text, as SvelteKit does: Vite's tag descriptors escape the
    // quotes to &#39;, which emit-caddy-csp.ts would copy into the header.
    // It follows the charset declaration and precedes every script it governs.
    transformIndexHtml(html) {
      const charset = /<meta charset="[^"]*">/i.exec(html)?.[0];
      if (!charset) throw new Error('index.html has no <meta charset> to put the policy after');
      // A replacer function: `$&` or `$'` in an env-derived policy is not a replacement pattern.
      return html.replace(
        charset,
        () => `${charset}\n    <meta http-equiv="content-security-policy" content="${policy}">`
      );
    }
  };
}

/** The same shape SvelteKit writes, so a tab of either build reads the other's file. */
export function versionFile(version: string): string {
  return JSON.stringify({ version });
}

/** The build id: SvelteKit's default, the build time. vite.config.ts computes it once for the bundle and the file. */
export function buildVersion(): string {
  return Date.now().toString();
}

export function versionFilePlugin(version = buildVersion()): Plugin {
  return {
    name: 'voiceroom-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_app/version.json', source: versionFile(version) });
    }
  };
}

const SERVICE_WORKER_PATH = '/service-worker.js';

/**
 * `src/service-worker.ts` served at /service-worker.js, as SvelteKit did: one
 * self-contained module in the build, the transformed source on the dev server.
 * The page registers it with `type: 'module'` (push-notifications.store.ts).
 */
export function serviceWorkerPlugin(entry = 'src/service-worker.ts'): Plugin {
  let root = process.cwd();
  let outDir = 'dist';
  let isBuild = false;
  let mode = 'production';
  let failed = false;
  return {
    name: 'voiceroom-service-worker',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
      isBuild = config.command === 'build';
      mode = config.mode;
    },
    buildEnd(error) {
      failed = Boolean(error);
    },
    configureServer(server) {
      server.middlewares.use(SERVICE_WORKER_PATH, (_request, response, next) => {
        server
          .transformRequest(`/${entry}`)
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
    async closeBundle() {
      // Same mode as the app; nothing to add to a build that failed.
      if (!isBuild || failed) return;
      await build({
        configFile: false,
        root,
        mode,
        logLevel: 'warn',
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: true,
          lib: { entry: resolve(root, entry), formats: ['es'], fileName: () => SERVICE_WORKER_PATH.slice(1) }
        }
      });
    }
  };
}
