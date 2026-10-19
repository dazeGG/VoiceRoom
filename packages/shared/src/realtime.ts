// The realtime (WebSocket) envelope: what a client may send, what the server
// answers, typing notices, and the room summary the lobby shows. Both ends
// check frames against the schemas of contracts/realtime.ts here.

import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';
import type { ErrorCode } from './contracts/errors.ts';
import {
  ClientCommandFrames,
  ServerErrorFrame,
  ServerEventFrames,
  type ClientCommand,
  type ClientCommandType,
  type RoomPeerSummary,
  type RoomRealtimeSummary,
  type RoomTypist,
  type ServerEventOf,
  type ServerEvents,
  type ServerEventType,
  type ServerFrame,
  type TypingActivity
} from './contracts/realtime.ts';
import { RoomRelationship } from './contracts/rooms.ts';
import { cleanName } from './validation.ts';
import { isRecord } from './guards.ts';
import { firstMismatch } from './contracts/http.ts';

export const MAX_VISIBLE_ROOM_PEERS = 5 as const;
export const SUMMARY_COALESCE_MS = 75 as const;

export type { RoomPeerSummary, RoomRealtimeSummary, RoomTypist, TypingActivity };
/** Any frame the server sends. */
export type ServerEnvelope = ServerFrame;

/** The commands the WS server handles: exactly the contract's command map. */
export const KNOWN_CLIENT_TYPES: ReadonlySet<string> = new Set(Object.keys(ClientCommandFrames));

// A typing notice is only a hint and is never stored: a client repeats it at
// most every TYPING_NOTICE_INTERVAL_MS while its composer has text, and a
// receiver drops it TYPING_NOTICE_TTL_MS after the last one arrived.
export const TYPING_NOTICE_INTERVAL_MS = 2500 as const;
export const TYPING_NOTICE_TTL_MS = 6000 as const;
// What the person is doing in the composer.
export const TYPING_ACTIVITIES: readonly TypingActivity[] = Object.freeze(['typing', 'emoji']);

function isClientCommandType(type: string): type is ClientCommandType {
  return Object.hasOwn(ClientCommandFrames, type);
}

function isServerEventType(type: string): type is ServerEventType {
  return Object.hasOwn(ServerEventFrames, type);
}

/** A frame as it arrived: a type and an object payload, not yet checked against its command. */
type RawEnvelope = { id?: string; type: string; payload: Record<string, unknown> };

export function parseClientEnvelope(
  raw: unknown
): { ok: true; envelope: RawEnvelope } | { ok: false; code: ErrorCode } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, code: 'empty_message' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid_json' };
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string' || !parsed.type.trim()) {
    return { ok: false, code: 'invalid_envelope' };
  }

  if (parsed.payload !== undefined && !isRecord(parsed.payload) && parsed.payload !== null) {
    return { ok: false, code: 'invalid_payload' };
  }

  return {
    ok: true,
    envelope: {
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      type: parsed.type.trim(),
      // No payload, or null, sends nothing.
      payload: isRecord(parsed.payload) ? parsed.payload : {}
    }
  };
}

/** The one way the API builds an event: the payload must be the one its type carries. */
export function buildServerEnvelope<Type extends ServerEventType>(
  type: Type,
  payload: ServerEvents[Type],
  id?: unknown
): ServerEventOf<Type> {
  const envelope: ServerEventOf<Type> = { type, payload };
  if (typeof id === 'string' && id) envelope.id = id;
  return envelope;
}

export function buildServerErrorEnvelope(code: ErrorCode, message: string, id?: unknown): ServerErrorFrame {
  const envelope: ServerErrorFrame = {
    type: 'error',
    error: { code, message }
  };
  if (typeof id === 'string' && id) envelope.id = id;
  return envelope;
}

function relationshipOf(value: unknown): RoomRelationship {
  return Value.Check(RoomRelationship, value) ? value : 'owner';
}

/** A peer the lobby card shows: a public peer, of which only these fields are read. */
export type PeerSummarySource = {
  id: string;
  accountUserId?: string | null;
  avatarAccent?: string | null;
  avatarColorKey?: string | null;
  avatarUrl?: string | null;
  muted?: boolean;
  name?: string;
};

/** A room the lobby card describes: a lobby room (`roomId`) or a stored one (`id`). */
export type RoomSummarySource = {
  roomId?: string;
  id?: string;
  avatarUrl?: string | null;
  name?: string;
  isStatic?: boolean;
  relationship?: string;
  lastMessageAt?: number | null;
  unreadCount?: number;
};

/** Picks a peer's avatar colour when it carries none. */
export type AvatarColorResolver = (peerId: string) => string;

export function toRoomPeerSummary(
  peer: PeerSummarySource,
  resolveAvatarColorKey?: AvatarColorResolver
): RoomPeerSummary {
  return {
    id: peer.id,
    accountUserId: peer.accountUserId || undefined,
    avatarAccent: peer.avatarAccent ?? null,
    avatarColorKey: peer.avatarColorKey || resolveAvatarColorKey?.(peer.id) || 'blurple',
    avatarUrl: peer.avatarUrl ?? null,
    muted: Boolean(peer.muted),
    name: cleanName(peer.name)
  };
}

export function buildRoomRealtimeSummary(
  room: RoomSummarySource,
  peers: readonly PeerSummarySource[],
  resolveAvatarColorKey?: AvatarColorResolver
): RoomRealtimeSummary {
  const visiblePeers = peers
    .slice(0, MAX_VISIBLE_ROOM_PEERS)
    .map((peer) => toRoomPeerSummary(peer, resolveAvatarColorKey));
  const peerCount = peers.length;

  return {
    roomId: room.roomId || room.id || '',
    avatarUrl: room.avatarUrl ?? null,
    name: room.name || '',
    isStatic: Boolean(room.isStatic),
    relationship: relationshipOf(room.relationship),
    peers: peerCount,
    visiblePeers,
    hiddenPeerCount: Math.max(0, peerCount - visiblePeers.length),
    lastMessageAt: room.lastMessageAt ?? null,
    unreadCount: room.unreadCount
  };
}

// A refused command names the first wrong field in this order, so a client
// learns which value to fix; anything else is invalid_payload.
const FIELD_CODES: ReadonlyArray<readonly [field: string, code: ErrorCode]> = [
  ['roomId', 'invalid_room_id'],
  ['peerId', 'invalid_peer_id'],
  ['sessionToken', 'invalid_session_token'],
  ['name', 'invalid_name'],
  ['kind', 'invalid_media_kind'],
  ['userId', 'invalid_user_id'],
  ['activity', 'invalid_typing_activity'],
  ['at', 'invalid_ping']
];

function refusalCode(schema: TSchema, payload: unknown): ErrorCode {
  const fields = new Set<string>();
  for (const error of Value.Errors(schema, payload)) {
    if (error.keyword === 'required') {
      for (const field of error.params.requiredProperties) fields.add(field);
    } else {
      fields.add(error.instancePath.split('/')[1] ?? '');
    }
  }
  return FIELD_CODES.find(([field]) => fields.has(field))?.[1] ?? 'invalid_payload';
}

/**
 * Checks a parsed frame against its command's schema. This is the one place a
 * client frame becomes a typed ClientCommand: fields the schema does not name
 * are dropped, and every field a handler reads is checked here.
 */
export function validateClientCommand(
  envelope: unknown
): { ok: true; envelope: ClientCommand } | { ok: false; code: ErrorCode } {
  if (!isRecord(envelope) || typeof envelope.type !== 'string') {
    return { ok: false, code: 'invalid_envelope' };
  }
  const type = envelope.type;
  if (!isClientCommandType(type)) {
    return { ok: false, code: 'unknown_type' };
  }

  const schema = ClientCommandFrames[type];
  const payloadSchema = schema.properties.payload;
  const payload = Value.Clean(payloadSchema, isRecord(envelope.payload) ? Value.Clone(envelope.payload) : {});
  const id = typeof envelope.id === 'string' && envelope.id ? envelope.id : undefined;
  const command = { ...(id ? { id } : {}), type, payload };
  if (!Value.Check(schema, command)) {
    return { ok: false, code: refusalCode(payloadSchema, payload) };
  }
  return { ok: true, envelope: command };
}

/**
 * Checks a frame the server sent against its event's schema (or the error
 * frame's). A frame that does not match, or names an event this build does not
 * know, is refused with the type it claimed and the first mismatch, so the
 * receiver can log it.
 */
export function parseServerFrame(
  frame: unknown
): { ok: true; frame: ServerFrame } | { ok: false; type: string; reason: string } {
  if (!isRecord(frame) || typeof frame.type !== 'string') return { ok: false, type: '', reason: 'not a frame' };
  const type = frame.type;
  if (type === 'error') {
    return Value.Check(ServerErrorFrame, frame)
      ? { ok: true, frame }
      : { ok: false, type, reason: firstMismatch(ServerErrorFrame, frame) };
  }
  if (!isServerEventType(type)) return { ok: false, type, reason: 'unknown event type' };
  const schema = ServerEventFrames[type];
  return Value.Check(schema, frame) ? { ok: true, frame } : { ok: false, type, reason: firstMismatch(schema, frame) };
}
