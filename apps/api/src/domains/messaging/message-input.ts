// Normalising what a client sends with a message: text, attachment ids,
// reply target ids and the idempotency key. Shared by room chat and DMs.

import crypto from 'node:crypto';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const MAX_MESSAGE_ATTACHMENTS = 4;

export function cleanUuid(value: unknown): string {
  const id = String(value || '').trim();
  return UUID.test(id) ? id : '';
}

/** `[]` when absent, `null` when malformed, duplicated or too many. */
export function normalizeAttachmentIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MESSAGE_ATTACHMENTS) return null;
  const ids = value.map((id) => cleanUuid(id));
  return ids.every(Boolean) && new Set(ids).size === ids.length ? ids : null;
}

/** The Idempotency-Key header, or the body's idempotencyKey; '' when unusable. */
export function requestIdempotencyKey(req: { headers?: Record<string, unknown> } | null | undefined, body: { idempotencyKey?: unknown } | null | undefined): string {
  const value = req?.headers?.['idempotency-key'] ?? body?.idempotencyKey;
  const key = typeof value === 'string' ? value.trim() : '';
  return key.length >= 8 && key.length <= 160 ? key : '';
}

export function messageFingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Multiline since 2.4.0: horizontal whitespace runs collapse, blank lines are
// capped at one, at most 20 lines and 500 characters survive.
export function cleanChatText(value: unknown): string {
  let text = String(value || '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const lines = text.split('\n');
  if (lines.length > 20) text = lines.slice(0, 20).join('\n');
  return text.slice(0, 500);
}
