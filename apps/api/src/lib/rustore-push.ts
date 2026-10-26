// Sending one push to one Android app through RuStore Push
// (https://vkpns.rustore.ru, the single-provider API). The client never
// throws: every answer, timeout and network error becomes an outcome the
// caller acts on. buildRuStoreMessage shapes the message and keeps it within
// RuStore's 4096 bytes.

import type { PushPayload } from '@voice-room/shared/notifications';
import {
  NATIVE_PUSH_TEXT_LIMITS,
  buildNativePushData,
  clipNativePushText,
  nativePushChannel
} from '@voice-room/shared/native-push';
import { textOf } from '@voice-room/shared/guards';
import { fieldOf } from '../platform/record.ts';

const RUSTORE_PUSH_ORIGIN = 'https://vkpns.rustore.ru';
/** The largest request body RuStore accepts, in UTF-8 bytes. */
export const RUSTORE_MESSAGE_MAX_BYTES = 4096;
const ERROR_MESSAGE_LIMIT = 300;
// RuStore drops a notification without a title.
const FALLBACK_TITLE = 'VoiceRoom';

export type RuStoreMessage = {
  token: string;
  data: Record<string, string>;
  notification?: { title: string; body?: string };
  android?: { ttl?: string; notification?: { channel_id: string } };
};

/**
 * - `sent`: RuStore took the push.
 * - `expired_token`: the token is gone (404 NOT_FOUND, or UNREGISTERED); forget it.
 * - `rejected`: RuStore refused the message (400); keep the token, a retry will not help.
 * - `unauthorized`: the project id or service token is wrong (401, 403); keep the token.
 * - `retryable`: 429, 5xx, any other status, a timeout or a network error.
 */
export type RuStoreSendOutcome = 'sent' | 'expired_token' | 'rejected' | 'unauthorized' | 'retryable';

export type RuStoreSendResult = {
  outcome: RuStoreSendOutcome;
  /** The HTTP status, or null when no answer arrived. */
  httpStatus: number | null;
  /** RuStore's error status (`NOT_FOUND`, `INVALID_ARGUMENT`, ...), or why no answer arrived. */
  status: string;
  /** RuStore's error message, cut short. */
  message: string;
};

function outcomeOf(httpStatus: number, status: string): RuStoreSendOutcome {
  if (httpStatus >= 200 && httpStatus < 300) return 'sent';
  if (status === 'UNREGISTERED' || (httpStatus === 404 && status === 'NOT_FOUND')) return 'expired_token';
  if (httpStatus === 400) return 'rejected';
  if (httpStatus === 401 || httpStatus === 403) return 'unauthorized';
  return 'retryable';
}

// The `{ error: { code, message, status } }` RuStore answers with, read field by field.
function errorOf(body: unknown): { status: string; message: string } {
  const error = fieldOf(body, 'error');
  return {
    status: textOf(fieldOf(error, 'status')).slice(0, 64),
    message: textOf(fieldOf(error, 'message')).slice(0, ERROR_MESSAGE_LIMIT)
  };
}

export function createRuStorePushClient({
  projectId,
  serviceToken,
  fetch = globalThis.fetch,
  timeoutMs = 5000
}: {
  projectId: string;
  serviceToken: string;
  fetch?: typeof globalThis.fetch | undefined;
  timeoutMs?: number;
}) {
  const url = `${RUSTORE_PUSH_ORIGIN}/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

  async function send(message: RuStoreMessage): Promise<RuStoreSendResult> {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
        signal
      });
    } catch (error) {
      return {
        outcome: 'retryable',
        httpStatus: null,
        status: signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: textOf(fieldOf(error, 'message')).slice(0, ERROR_MESSAGE_LIMIT)
      };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // An empty or non-JSON body carries no error details.
    }
    const { status, message: errorMessage } = errorOf(body);
    return { outcome: outcomeOf(response.status, status), httpStatus: response.status, status, message: errorMessage };
  }

  return { send };
}

export type RuStorePushClient = ReturnType<typeof createRuStorePushClient>;

function byteLength(message: RuStoreMessage): number {
  return Buffer.byteLength(JSON.stringify({ message }), 'utf8');
}

/**
 * The message for one token. A ring is data-only and expires with its TTL; any
 * other type is a notification, with mentions separated only on capable devices. Over 4096 bytes the
 * body is dropped; null when even that does not fit.
 */
export function buildRuStoreMessage({
  token,
  payload,
  nativeData = {},
  ttlSeconds,
  notificationChannels = []
}: {
  token: string;
  payload: PushPayload;
  nativeData?: Readonly<Record<string, string>>;
  ttlSeconds?: number | undefined;
  notificationChannels?: readonly string[];
}): RuStoreMessage | null {
  const data = buildNativePushData(payload, nativeData);
  const channel = nativePushChannel(data.type, notificationChannels);
  const ttl = ttlSeconds === undefined ? undefined : `${Math.max(0, Math.floor(ttlSeconds))}s`;
  const message: RuStoreMessage = { token, data: { ...data } };
  if (channel === null) {
    if (ttl !== undefined) message.android = { ttl };
  } else {
    message.notification = {
      title: clipNativePushText(payload.title || FALLBACK_TITLE, NATIVE_PUSH_TEXT_LIMITS.title),
      body: clipNativePushText(payload.body ?? '', NATIVE_PUSH_TEXT_LIMITS.body)
    };
    message.android = { ...(ttl === undefined ? {} : { ttl }), notification: { channel_id: channel } };
  }
  if (byteLength(message) <= RUSTORE_MESSAGE_MAX_BYTES) return message;
  const { body: _dataBody, ...dataWithoutBody } = message.data;
  const shorter: RuStoreMessage = { ...message, data: dataWithoutBody };
  if (message.notification) shorter.notification = { title: message.notification.title };
  return byteLength(shorter) <= RUSTORE_MESSAGE_MAX_BYTES ? shorter : null;
}
