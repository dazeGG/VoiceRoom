// The security headers every API response carries. The CSP connect-src
// admits the LiveKit gate (browsers reach the SFU only through it) and, in
// development, the local SFU; everything else stays same-origin.

/** Origins the LiveKit URL can be reached at; localhost and 127.0.0.1 count as one host. */
export function liveKitConnectSources(url: string): string[] {
  if (!url) return [];
  const sources = new Set<string>();
  try {
    const parsed = new URL(url);
    sources.add(parsed.origin);
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
      sources.add(parsed.origin);
    } else if (parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'localhost';
      sources.add(parsed.origin);
    }
  } catch {
    // A malformed LIVEKIT_URL is ignored; the client surfaces the connection error.
  }
  return [...sources];
}

export function securityHeaders({
  connectSources,
  production
}: {
  connectSources: string[];
  production: boolean;
}): Record<string, string> {
  const connectSrc = [
    "'self'",
    ...connectSources,
    ...(production ? [] : ['ws://localhost:7880', 'ws://127.0.0.1:7880']),
    'stun:',
    'turn:',
    'turns:'
  ].join(' ');

  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'none'",
      `connect-src ${connectSrc}`,
      "font-src 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      // blob: serves local-only previews (avatar crop) rendered via object URLs.
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "object-src 'none'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self'"
    ].join('; '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'microphone=(self), display-capture=(self), camera=(), geolocation=(), payment=()',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff'
  };
}
