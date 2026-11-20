import type { Plugin } from 'vite';

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

export function cspMetaPlugin(directives: Record<string, readonly string[]>): Plugin {
  const policy = metaPolicy(directives);
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
