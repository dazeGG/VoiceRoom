import { PEER_SESSION_STORAGE_PREFIX } from './config';
import type { PeerSession } from './types';

export function getRoomIdFromPath(): string {
  const match = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]{3,48})\/?$/);
  return match ? match[1] : '';
}

export function createPeerId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getStoredPeerSession(roomId: string): PeerSession {
  const fallback = {
    peerId: createPeerId(),
    sessionToken: createSessionToken()
  };
  if (!roomId) return fallback;

  const storageKey = `${PEER_SESSION_STORAGE_PREFIX}${roomId}`;
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    const peerId = typeof stored?.peerId === 'string' ? stored.peerId : '';
    const sessionToken = typeof stored?.sessionToken === 'string' ? stored.sessionToken : '';
    if (/^[A-Za-z0-9_-]{8,80}$/.test(peerId) && /^[A-Za-z0-9_-]{32,128}$/.test(sessionToken)) {
      return { peerId, sessionToken };
    }
  } catch {
    // A malformed stored session should not block joining the room.
  }

  try {
    sessionStorage.setItem(storageKey, JSON.stringify(fallback));
  } catch {
    // Session storage may be unavailable in hardened browser contexts.
  }
  return fallback;
}

export function extractRoomId(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw, window.location.origin);
    const match = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{3,48})\/?$/);
    if (match) return match[1];
  } catch {
    // Plain room codes are handled below.
  }

  const routeMatch = raw.match(/(?:^|\/)r\/([A-Za-z0-9_-]{3,48})\/?$/);
  if (routeMatch) return routeMatch[1];

  const compact = raw.replace(/^#/, '').trim();
  return /^[A-Za-z0-9_-]{3,48}$/.test(compact) ? compact : '';
}
