// The `data` map of a push to the Android app (RuStore today). The API builds
// it with buildNativePushData from the same payload Web Push sends plus the
// push context's extra keys; the app reads it with parseNativePushData. Every
// value is a string, as RuStore requires. Keys are only ever added; `v`
// changes only when an old app could no longer read the map.

import { isRecord } from './guards.ts';
import type { PushPayload } from './notifications.ts';

export const NATIVE_PUSH_DATA_VERSION = '1';

/**
 * The Android notification channels the app creates. A notification push
 * names `messages`, or `mentions` only if native code confirms that channel.
 * A ring is data-only and the app posts its own call
 * notification on `calls`.
 */
export const NATIVE_PUSH_CHANNELS = Object.freeze({
  messages: 'messages',
  mentions: 'mentions',
  calls: 'calls'
} as const);
export type NativePushChannel = (typeof NATIVE_PUSH_CHANNELS)[keyof typeof NATIVE_PUSH_CHANNELS];

/** The longest title, body and name a push carries, in characters, so a push stays within RuStore's 4096 bytes. */
export const NATIVE_PUSH_TEXT_LIMITS = Object.freeze({ title: 100, body: 240, name: 64 } as const);

const RING = 'ring';

/** Keys the sender adds from the push context, next to the payload's own. */
const EXTRA_KEYS = [
  // A direct message: who wrote and which message.
  'peerUserId',
  'messageId',
  // A ring: who calls and into which room.
  'fromUserId',
  'fromName',
  'roomId',
  'roomName',
  'roomEmoji',
  'ringId',
  'recipientUserId',
  'ringRevision',
  'ringState'
] as const;
const NAME_KEYS: ReadonlySet<string> = new Set(['fromName', 'roomName']);
const OPTIONAL_KEYS = ['notificationId', 'expiresAt', 'title', 'body', ...EXTRA_KEYS] as const;

export type NativePushData = {
  v: string;
  /** The payload's type (`dm.message`, `ring`, ...), `notification` for a mention or reply, else `unknown`. */
  type: string;
  /** The same-site path the push opens. */
  url: string;
  /** A retried delivery can repeat a push; the app shows one per key. */
  dedupeKey: string;
} & Partial<Record<(typeof OPTIONAL_KEYS)[number], string>>;

/** The text cut to `limit` characters, never inside a surrogate pair. */
export function clipNativePushText(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length <= limit ? text : characters.slice(0, limit).join('');
}

/** The channel a push is shown on, or null for a data-only push (a ring). */
export function nativePushChannel(
  type: string,
  notificationChannels: readonly string[] = []
): NativePushChannel | null {
  if (type === RING || type === 'ring.state') return null;
  return type === 'notification' && notificationChannels.includes(NATIVE_PUSH_CHANNELS.mentions)
    ? NATIVE_PUSH_CHANNELS.mentions
    : NATIVE_PUSH_CHANNELS.messages;
}

function nativePushType(payload: PushPayload): string {
  if (payload.type) return payload.type;
  // The notification outbox's mention and reply pushes carry no type.
  return payload.notificationId ? 'notification' : 'unknown';
}

/**
 * The data of a push. A data-only push (a ring) carries its title and body
 * here, since nothing else shows them; a notification push carries them in
 * its notification instead. `revision` and `contractVersion` stay out:
 * `dedupeKey` already names the revision.
 */
export function buildNativePushData(
  payload: PushPayload,
  extra: Readonly<Record<string, string>> = {}
): NativePushData {
  const type = nativePushType(payload);
  const data: NativePushData = {
    v: NATIVE_PUSH_DATA_VERSION,
    type,
    url: payload.url ?? '',
    dedupeKey: payload.dedupeKey ?? ''
  };
  if (payload.notificationId) data.notificationId = payload.notificationId;
  if (payload.expiresAt !== undefined && Number.isFinite(payload.expiresAt)) data.expiresAt = String(payload.expiresAt);
  if (nativePushChannel(type) === null) {
    data.title = clipNativePushText(payload.title ?? '', NATIVE_PUSH_TEXT_LIMITS.title);
    data.body = clipNativePushText(payload.body ?? '', NATIVE_PUSH_TEXT_LIMITS.body);
  }
  for (const key of EXTRA_KEYS) {
    const value = extra[key];
    if (value === undefined) continue;
    data[key] = NAME_KEYS.has(key) ? clipNativePushText(value, NATIVE_PUSH_TEXT_LIMITS.name) : value;
  }
  return data;
}

/** A received push's data, or null when it is not a VoiceRoom push this app can read. */
export function parseNativePushData(map: unknown): NativePushData | null {
  if (!isRecord(map)) return null;
  const text = (key: string): string | undefined => {
    const value = map[key];
    return typeof value === 'string' ? value : undefined;
  };
  const type = text('type');
  if (text('v') !== NATIVE_PUSH_DATA_VERSION || !type) return null;
  const data: NativePushData = {
    v: NATIVE_PUSH_DATA_VERSION,
    type,
    url: text('url') ?? '',
    dedupeKey: text('dedupeKey') ?? ''
  };
  for (const key of OPTIONAL_KEYS) {
    const value = text(key);
    if (value !== undefined) data[key] = value;
  }
  return data;
}

/** True for a ring whose `expiresAt` (epoch milliseconds) is still ahead; the app drops any other ring. */
export function isRingLive(data: Pick<NativePushData, 'type' | 'expiresAt'>, now: number): boolean {
  return data.type === RING && Number(data.expiresAt) > now;
}
