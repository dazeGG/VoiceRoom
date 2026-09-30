// The session cookie: HttpOnly, SameSite=Lax, Secure in production, and a
// tolerant reader that skips malformed values instead of failing a request.

export function parseCookies(req: { headers?: { cookie?: unknown } } | null | undefined): Record<string, string> {
  const header = req?.headers?.cookie;
  const cookies: Record<string, string> = {};
  if (typeof header !== 'string' || !header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // A malformed value is ignored rather than failing auth with a 500.
    }
  }
  return cookies;
}

export function createSessionCookies({
  name,
  secure,
  maxAgeSeconds
}: {
  name: string;
  secure: boolean;
  maxAgeSeconds: number;
}) {
  const attributes = (maxAge: number) => {
    const parts = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(maxAge))}`];
    if (secure) parts.push('Secure');
    return parts;
  };
  return {
    read: (req: Parameters<typeof parseCookies>[0]): string => parseCookies(req)[name] || '',
    issue: (token: string): string => [`${name}=${encodeURIComponent(token)}`, ...attributes(maxAgeSeconds)].join('; '),
    clear: (): string => [`${name}=`, ...attributes(0)].join('; ')
  };
}
