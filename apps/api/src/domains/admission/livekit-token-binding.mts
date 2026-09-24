// The gate credential authorizes one (room, peer, principal) admission, but the
// LiveKit JWT travelling next to it is what the SFU actually honours. Without
// tying the two together a caller could present a fresh gate credential with a
// stale JWT (issued before a server mute) or with a JWT for another room it was
// banned from. The gate does not need to verify the JWT signature — LiveKit does
// that — it only needs to refuse any token whose identity, room or issue time
// does not match the credential it just admitted.

import type { IncomingHttpHeaders } from 'node:http';

export const DEFAULT_ROOM_PREFIX = 'voice-room-';
// A JWT minted for this admission is signed moments after the gate credential;
// allow a little clock skew between the two (both come from the same API
// process, the skew is really only integer-second rounding of `nbf`).
export const TOKEN_ISSUE_SKEW_MS = 5_000;

/** The part of a verified gate credential the binding compares against. */
export interface GateClaims {
  iat: number;
  peer: string;
  room: string;
}

export type BindingResult =
  | { ok: true }
  | {
    ok: false;
    code:
      | 'missing_claims'
      | 'missing_token'
      | 'ambiguous_token'
      | 'malformed_authorization'
      | 'malformed_token'
      | 'identity_mismatch'
      | 'room_mismatch'
      | 'stale_token';
  };

export type TokenExtraction =
  | { ok: true; token: string }
  | { ok: false; code: 'missing_token' | 'ambiguous_token' | 'malformed_authorization' };

interface LiveKitJwtPayload {
  sub?: unknown;
  nbf?: unknown;
  video?: { room?: unknown } | null;
}

export function normalizeLiveKitRoomPrefix(value: string | null | undefined = process.env.LIVEKIT_ROOM_PREFIX): string {
  const raw = value === undefined || value === null ? DEFAULT_ROOM_PREFIX : String(value);
  return raw.replace(/[^A-Za-z0-9_.:-]/g, '-');
}

export function getLiveKitRoomName(roomId: string, prefix: string = normalizeLiveKitRoomPrefix()): string {
  return `${prefix}${roomId}`;
}

export function decodeJwtPayload(token: string): LiveKitJwtPayload | null {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as LiveKitJwtPayload : null;
  } catch {
    return null;
  }
}

// '' when there is no header, null when it is present but unusable.
function readBearer(headers: IncomingHttpHeaders): string | null {
  const value: unknown = headers.authorization;
  if (Array.isArray(value)) return value.length === 1 ? readBearer({ authorization: value[0] }) : null;
  if (typeof value !== 'string' || !value) return '';
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

// Returns the token LiveKit itself would authenticate with: the Authorization
// header wins over the query parameter. Anything ambiguous (several query
// values, an unparsable header, header and query disagreeing) is rejected so
// the gate never checks one token while LiveKit reads another.
export function extractAccessToken(requestUrl: string | undefined, headers: IncomingHttpHeaders = {}): TokenExtraction {
  const parsed = new URL(requestUrl || '/', 'ws://gate.local');
  const queryTokens = parsed.searchParams.getAll('access_token');
  if (queryTokens.length > 1) return { ok: false, code: 'ambiguous_token' };
  const bearer = readBearer(headers);
  if (bearer === null) return { ok: false, code: 'malformed_authorization' };
  const queryToken = queryTokens[0] || '';
  if (bearer && queryToken && bearer !== queryToken) return { ok: false, code: 'ambiguous_token' };
  const token = bearer || queryToken;
  return token ? { ok: true, token } : { ok: false, code: 'missing_token' };
}

export function verifyAccessTokenBinding({
  claims,
  requestUrl,
  headers = {},
  roomPrefix = normalizeLiveKitRoomPrefix()
}: {
  claims?: GateClaims | null;
  requestUrl?: string;
  headers?: IncomingHttpHeaders;
  roomPrefix?: string;
} = {}): BindingResult {
  if (!claims || typeof claims !== 'object') return { ok: false, code: 'missing_claims' };
  const extracted = extractAccessToken(requestUrl, headers);
  if (!extracted.ok) return extracted;
  const payload = decodeJwtPayload(extracted.token);
  if (!payload) return { ok: false, code: 'malformed_token' };
  if (typeof payload.sub !== 'string' || payload.sub !== claims.peer) return { ok: false, code: 'identity_mismatch' };
  const room = payload.video && typeof payload.video === 'object' ? payload.video.room : undefined;
  if (typeof room !== 'string' || room !== getLiveKitRoomName(claims.room, roomPrefix)) {
    return { ok: false, code: 'room_mismatch' };
  }
  // livekit-server-sdk stamps `nbf` with the signing time, and tokens LiveKit
  // refreshes for a connected participant carry their own later `nbf`. A token
  // older than the credential therefore predates this admission.
  const notBefore = Number(payload.nbf);
  if (!Number.isFinite(notBefore) || notBefore * 1000 < Number(claims.iat) - TOKEN_ISSUE_SKEW_MS) {
    return { ok: false, code: 'stale_token' };
  }
  return { ok: true };
}
