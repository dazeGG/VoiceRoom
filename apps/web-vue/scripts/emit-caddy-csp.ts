// Turns the CSP the build writes into dist/index.html (scripts/deploy-contract.ts)
// into the header Caddy sends on every response of the web origin.
//
// The <meta> policy is only a floor: a meta tag cannot carry frame-ancestors and
// does not cover API responses, error pages or any future non-HTML route. The
// build has no inline script, so the policy carries no hash and script-src stays
// at 'self' without 'unsafe-inline'. The image does not know the deployment's
// LiveKit origin either, so connect-src is left wide in the meta tag and
// narrowed here with Caddy's {$LIVEKIT_DOMAIN} placeholder, which Caddy fills in
// from the environment when it loads the imported file.
//
// Usage: node emit-caddy-csp.ts <dist/index.html> > csp.caddy

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONNECT_SRC = "'self' wss://{$LIVEKIT_DOMAIN} https://{$LIVEKIT_DOMAIN} stun: turn: turns:";
// A <script> tag without a src attribute.
const INLINE_SCRIPT = /<script\b(?![^>]*\ssrc\s*=)[^>]*>/i;

export function readMetaPolicy(html: string): string {
  const policy = /<meta\s+http-equiv="content-security-policy"\s+content="([^"]+)"/i.exec(String(html || ''))?.[1];
  if (!policy) throw new Error('dist/index.html has no content-security-policy meta tag');
  if (INLINE_SCRIPT.test(html)) throw new Error('dist/index.html has an inline <script>, which its own policy blocks');
  return policy;
}

export function buildHeaderPolicy(metaPolicy: string) {
  const directives = new Map<string, string>();
  for (const part of String(metaPolicy).split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name = '', ...values] = trimmed.split(/\s+/);
    directives.set(name.toLowerCase(), values.join(' '));
  }
  const scriptSources = (directives.get('script-src') || '').split(' ');
  if (!scriptSources.includes("'self'")) {
    throw new Error("script-src does not allow 'self'; refusing to emit a policy that would block the app");
  }
  if (scriptSources.includes("'unsafe-inline'")) {
    throw new Error("script-src allows 'unsafe-inline'; the build has no inline script that would need it");
  }
  directives.set('connect-src', CONNECT_SRC);
  directives.set('frame-ancestors', "'none'");
  directives.set('worker-src', "'self'");
  directives.set('manifest-src', "'self'");
  return Array.from(directives, ([name, value]) => `${name} ${value}`).join('; ');
}

export function renderCaddySnippet(policy: string) {
  if (policy.includes('"')) throw new Error('policy cannot contain a double quote');
  return `# Generated at image build by apps/web/scripts/emit-caddy-csp.ts — do not edit.\nContent-Security-Policy "${policy}"\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('usage: emit-caddy-csp.ts <dist/index.html>\n');
    process.exit(2);
  }
  process.stdout.write(renderCaddySnippet(buildHeaderPolicy(readMetaPolicy(fs.readFileSync(file, 'utf8')))));
}
