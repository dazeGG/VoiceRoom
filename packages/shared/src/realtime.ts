// The realtime (WebSocket) envelope: what a client may send, what the server
// answers, typing notices, and the room summary the lobby shows.

import type {
  ClientCommand,
  ClientCommandType,
  RoomPeerSummary,
  RoomRealtimeSummary,
  RoomTypist,
  ServerErrorFrame,
  ServerEvent,
  ServerEvents,
  ServerEventType,
  ServerFrame,
  TypingActivity
} from './contracts/realtime.ts';
import { cleanName, normalizePeerId, normalizeRoomId, normalizeSessionToken } from './validation.ts';

export const MAX_VISIBLE_ROOM_PEERS = 5 as const;
export const SUMMARY_COALESCE_MS = 75 as const;

export type { RoomPeerSummary, RoomRealtimeSummary, RoomTypist, TypingActivity };
/** Any frame the server sends. */
export type ServerEnvelope = ServerFrame;

type Loose = Record<string, unknown>;

// Only commands the WS server actually handles are accepted here. Chat and DM
// sends still travel over HTTP (POST /api/rooms/:id/chat, POST /api/dm/:id), so
// room.chat.send / dm.send / dm.read are intentionally absent until they are
// ported. Adding a type without a handler makes the client believe a channel
// exists that the server silently drops.
export const KNOWN_CLIENT_TYPES: ReadonlySet<string> = new Set<ClientCommandType>([
  'hello',
  'ping',
  'room.preview.subscribe',
  'room.preview.unsubscribe',
  'room.join',
  'room.leave',
  'room.peer.update',
  'room.chat.typing',
  'dm.typing'
]);

// A typing notice is only a hint and is never stored: a client repeats it at
// most every TYPING_NOTICE_INTERVAL_MS while its composer has text, and a
// receiver drops it TYPING_NOTICE_TTL_MS after the last one arrived.
export const TYPING_NOTICE_INTERVAL_MS = 2500 as const;
export const TYPING_NOTICE_TTL_MS = 6000 as const;
// What the person is doing in the composer. A notice without an activity comes
// from a client older than the emoji picker and means typing.
export const TYPING_ACTIVITIES: readonly TypingActivity[] = Object.freeze(['typing', 'emoji']);
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(value: unknown): value is Loose {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeTypingActivity(value: unknown): TypingActivity | null {
  if (value === undefined || value === null) return 'typing';
  return (TYPING_ACTIVITIES as readonly unknown[]).includes(value) ? (value as TypingActivity) : null;
}

/** A frame as it arrived: a type and an object payload, not yet checked against its command. */
type RawEnvelope = { id?: string; type: string; payload: Loose };

export function parseClientEnvelope(raw: unknown): { ok: true; envelope: RawEnvelope } | { ok: false; code: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, code: 'empty_message' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid_json' };
  }

  if (!isPlainObject(parsed) || typeof parsed.type !== 'string' || !parsed.type.trim()) {
    return { ok: false, code: 'invalid_envelope' };
  }

  if (parsed.payload !== undefined && !isPlainObject(parsed.payload) && parsed.payload !== null) {
    return { ok: false, code: 'invalid_payload' };
  }

  return {
    ok: true,
    envelope: {
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      type: parsed.type.trim(),
      payload: (parsed.payload === undefined ? {} : parsed.payload) as Loose
    }
  };
}

/** The one way the API builds an event: the payload must be the one its type carries. */
export function buildServerEnvelope<Type extends ServerEventType>(
  type: Type,
  payload: ServerEvents[Type],
  id?: unknown
): Extract<ServerEvent, { type: Type }> {
  const envelope = { type, payload } as Extract<ServerEvent, { type: Type }>;
  if (typeof id === 'string' && id) envelope.id = id;
  return envelope;
}

export function buildServerErrorEnvelope(code: string, message: string, id?: unknown): ServerErrorFrame {
  const envelope: ServerErrorFrame = {
    type: 'error',
    error: { code, message }
  };
  if (typeof id === 'string' && id) envelope.id = id;
  return envelope;
}

export function toRoomPeerSummary(peer: Loose, resolveAvatarColorKey?: unknown): RoomPeerSummary {
  const resolver =
    typeof resolveAvatarColorKey === 'function' ? (resolveAvatarColorKey as (peerId: unknown) => string) : () => '';
  return {
    id: peer.id as string,
    accountUserId: (peer.accountUserId as string) || undefined,
    avatarAccent: (peer.avatarAccent as string | null | undefined) ?? null,
    avatarColorKey: (peer.avatarColorKey as string) || resolver(peer.id) || 'blurple',
    avatarUrl: (peer.avatarUrl as string | null | undefined) ?? null,
    muted: Boolean(peer.muted),
    name: cleanName(peer.name)
  };
}

export function buildRoomRealtimeSummary(
  room: Loose,
  peers: unknown,
  resolveAvatarColorKey?: unknown
): RoomRealtimeSummary {
  const peerList = Array.isArray(peers) ? (peers as Loose[]) : [];
  const visiblePeers = peerList
    .slice(0, MAX_VISIBLE_ROOM_PEERS)
    .map((peer) => toRoomPeerSummary(peer, resolveAvatarColorKey));
  const peerCount = peerList.length;

  return {
    roomId: (room.roomId as string) || (room.id as string) || '',
    avatarUrl: (room.avatarUrl as string | null | undefined) ?? null,
    name: (room.name as string) || '',
    isStatic: Boolean(room.isStatic),
    relationship: (room.relationship as string) || 'owner',
    peers: peerCount,
    visiblePeers,
    hiddenPeerCount: Math.max(0, peerCount - visiblePeers.length),
    lastMessageAt: (room.lastMessageAt as number | null | undefined) ?? null,
    unreadCount: (room.unreadCount as number | undefined) ?? undefined
  };
}

/**
 * Checks a parsed frame against its command. This is the one place a client
 * frame becomes a typed ClientCommand, so every field a handler reads without
 * its own check is checked here.
 */
export function validateClientCommand(
  envelope: unknown
): { ok: true; envelope: ClientCommand } | { ok: false; code: string } {
  const input = envelope as { id?: unknown; type?: unknown; payload?: unknown } | null | undefined;
  if (!input || typeof input.type !== 'string') {
    return { ok: false, code: 'invalid_envelope' };
  }

  if (!KNOWN_CLIENT_TYPES.has(input.type)) {
    return { ok: false, code: 'unknown_type' };
  }

  const payload: Loose = isPlainObject(input.payload) ? input.payload : {};

  if (input.type === 'ping') {
    if (typeof payload.at !== 'number' || !Number.isFinite(payload.at)) {
      return { ok: false, code: 'invalid_ping' };
    }
  }

  if (input.type === 'room.preview.subscribe' || input.type === 'room.preview.unsubscribe') {
    if (!normalizeRoomId(payload.roomId)) return { ok: false, code: 'invalid_room_id' };
  }

  if (input.type === 'room.join' || input.type === 'room.leave') {
    if (!normalizeRoomId(payload.roomId)) return { ok: false, code: 'invalid_room_id' };
    if (!normalizePeerId(payload.peerId)) return { ok: false, code: 'invalid_peer_id' };
    if (!normalizeSessionToken(payload.sessionToken)) return { ok: false, code: 'invalid_session_token' };
  }

  if (input.type === 'room.join' && !cleanName(payload.name)) {
    return { ok: false, code: 'invalid_name' };
  }

  if (input.type === 'room.chat.typing' && !normalizeRoomId(payload.roomId)) {
    return { ok: false, code: 'invalid_room_id' };
  }

  if (input.type === 'dm.typing' && !(typeof payload.userId === 'string' && USER_ID_RE.test(payload.userId))) {
    return { ok: false, code: 'invalid_user_id' };
  }

  if ((input.type === 'room.chat.typing' || input.type === 'dm.typing') && !normalizeTypingActivity(payload.activity)) {
    return { ok: false, code: 'invalid_typing_activity' };
  }

  const id = typeof input.id === 'string' ? input.id : undefined;
  return { ok: true, envelope: { ...(id ? { id } : {}), type: input.type, payload } as ClientCommand };
}
