// Turns the CSP SvelteKit writes into dist/index.html into the header Caddy
// sends on every response of the web origin.
//
// The <meta> policy is only a floor: it holds the build-specific hash of the
// inline bootstrap script, but a meta tag cannot carry frame-ancestors and does
// not cover API responses, error pages or any future non-HTML route. The image
// does not know the deployment's LiveKit origin either, so connect-src is left
// wide in the meta tag and narrowed here with Caddy's {$LIVEKIT_DOMAIN}
// placeholder, which Caddy fills in from the environment when it loads the
// imported file.
//
// Usage: node emit-caddy-csp.mjs <dist/index.html> > csp.caddy

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONNECT_SRC = "'self' wss://{$LIVEKIT_DOMAIN} https://{$LIVEKIT_DOMAIN} stun: turn: turns:";

export function readMetaPolicy(html) {
  const match = /<meta\s+http-equiv="content-security-policy"\s+content="([^"]+)"/i.exec(String(html || ''));
  if (!match) throw new Error('dist/index.html has no content-security-policy meta tag');
  return match[1];
}

export function buildHeaderPolicy(metaPolicy) {
  const directives = new Map();
  for (const part of String(metaPolicy).split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...values] = trimmed.split(/\s+/);
    directives.set(name.toLowerCase(), values.join(' '));
  }
  if (!/'sha256-[A-Za-z0-9+/=]+'/.test(directives.get('script-src') || '')) {
    throw new Error('script-src has no bootstrap hash; refusing to emit a policy that would block the app');
  }
  directives.set('connect-src', CONNECT_SRC);
  directives.set('frame-ancestors', "'none'");
  directives.set('worker-src', "'self'");
  directives.set('manifest-src', "'self'");
  return Array.from(directives, ([name, value]) => `${name} ${value}`).join('; ');
}

export function renderCaddySnippet(policy) {
  if (policy.includes('"')) throw new Error('policy cannot contain a double quote');
  return `# Generated at image build by apps/web/scripts/emit-caddy-csp.mjs — do not edit.\nContent-Security-Policy "${policy}"\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('usage: emit-caddy-csp.mjs <dist/index.html>\n');
    process.exit(2);
  }
  process.stdout.write(renderCaddySnippet(buildHeaderPolicy(readMetaPolicy(fs.readFileSync(file, 'utf8')))));
}
