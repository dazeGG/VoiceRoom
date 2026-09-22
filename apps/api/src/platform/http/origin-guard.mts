// Origin checks for cookie-authenticated requests. The API trusts its session
// cookie, and SameSite=Lax still sends it from a sibling subdomain, so every
// state-changing request and every WebSocket handshake is also matched against
// the request's own host.

import type { IncomingMessage } from 'node:http';

type RequestLike = Pick<IncomingMessage, 'headers' | 'method'>;

export function requestHost(req: RequestLike): string {
  const host = req.headers?.host;
  return typeof host === 'string' ? host.toLowerCase() : '';
}

export function originHost(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
}

export function requestHasUnsafeMethod(req: RequestLike): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase());
}

export function hasValidSameOrigin(req: RequestLike): boolean {
  const host = requestHost(req);
  if (!host) return false;
  const origin = req.headers?.origin;
  if (typeof origin === 'string' && origin) return originHost(origin) === host;
  const referer = req.headers?.referer;
  if (typeof referer === 'string' && referer) return originHost(referer) === host;
  return true;
}

// A cookie-carrying write from another origin — including a sibling subdomain,
// which SameSite=Lax treats as same-site — is refused. Browsers always attach
// Origin to cross-origin unsafe requests, so a request with neither Origin nor
// Referer is a non-browser client that cannot be a CSRF vehicle.
export function isCrossOriginCookieWrite(req: RequestLike, hasSessionCookie: boolean): boolean {
  if (!requestHasUnsafeMethod(req)) return false;
  if (!hasSessionCookie) return false;
  const hasBrowserOrigin = Boolean(req.headers?.origin || req.headers?.referer);
  return hasBrowserOrigin && !hasValidSameOrigin(req);
}

// Browsers always send Origin on a WebSocket handshake and never enforce the
// same-origin policy on it, so the server has to: a page on any other origin
// could otherwise open an authenticated socket with the user's cookie and read
// their DMs, presence and typing (cross-site WebSocket hijacking).
export function isCrossOriginWebSocket(req: RequestLike): boolean {
  const upgrade = String(req.headers?.upgrade || '').toLowerCase();
  if (upgrade !== 'websocket') return false;
  const origin = req.headers?.origin;
  if (typeof origin !== 'string' || !origin) return false;
  const host = requestHost(req);
  return !host || originHost(origin) !== host;
}
