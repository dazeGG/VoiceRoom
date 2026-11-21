// Normalising what a client sends with a message: text, attachment ids,
// reply target ids and the idempotency key. Shared by room chat and DMs.

import crypto from 'node:crypto';
import { MAX_ATTACHMENTS } from '@voiceroom/shared/contracts/messages';
import { isArray, textOf } from '@voiceroom/shared/guards';
import { MAX_ROOM_MESSAGE_LENGTH } from '@voiceroom/shared/room-message-content';
import { isUuid } from '@voiceroom/shared/validation';

export function cleanUuid(value: unknown): string {
  const id = textOf(value).trim();
  return isUuid(id) ? id : '';
}

/** `[]` when absent, `null` when malformed, duplicated or too many. */
export function normalizeAttachmentIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!isArray(value) || value.length > MAX_ATTACHMENTS) return null;
  const ids = value.map((id) => cleanUuid(id));
  return ids.every(Boolean) && new Set(ids).size === ids.length ? ids : null;
}

/** The Idempotency-Key header, or the body's idempotencyKey; '' when unusable. */
export function requestIdempotencyKey(
  req: { headers?: Record<string, unknown> } | null | undefined,
  body: { idempotencyKey?: unknown } | null | undefined
): string {
  const value = req?.headers?.['idempotency-key'] ?? body?.idempotencyKey;
  const key = typeof value === 'string' ? value.trim() : '';
  return key.length >= 8 && key.length <= 160 ? key : '';
}

export function messageFingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Markdown source keeps indentation and blank lines. Whitespace alone still
// counts as an empty message.
export function cleanMessageText(value: unknown, maxChars: number): string {
  const text = textOf(value).replace(/\r\n?/g, '\n').slice(0, maxChars);
  return text.trim() ? text : '';
}

export function cleanChatText(value: unknown): string {
  return cleanMessageText(value, MAX_ROOM_MESSAGE_LENGTH);
}
