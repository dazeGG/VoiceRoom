import { PEER_SESSION_STORAGE_PREFIX } from './config';
import type { PeerSession } from './types';
import { isRecord } from '@voice-room/shared/guards';
import { newId } from '@/shared/new-id';

export function getRoomIdFromPath(): string {
  return window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]{3,48})\/?$/)?.[1] ?? '';
}

function createSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getStoredPeerSession(roomId: string): PeerSession {
  const fallback = {
    peerId: newId(),
    sessionToken: createSessionToken()
  };
  if (!roomId) return fallback;

  const storageKey = `${PEER_SESSION_STORAGE_PREFIX}${roomId}`;
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    const peerId = isRecord(stored) && typeof stored.peerId === 'string' ? stored.peerId : '';
    const sessionToken = isRecord(stored) && typeof stored.sessionToken === 'string' ? stored.sessionToken : '';
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

export function rotateStoredPeerSession(roomId: string): PeerSession {
  const next = { peerId: newId(), sessionToken: createSessionToken() };
  if (roomId) {
    try {
      sessionStorage.setItem(`${PEER_SESSION_STORAGE_PREFIX}${roomId}`, JSON.stringify(next));
    } catch {
      // The current runtime still receives fresh values when storage is unavailable.
    }
  }
  return next;
}
