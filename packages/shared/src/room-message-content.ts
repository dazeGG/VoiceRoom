// Structured room message content (v1): text, link and mention segments,
// capped in size, never HTML, with a plain-text projection for everything
// that shows only text.

import { isArray, isRecord, textOf } from './guards.ts';

export type RoomMessageTextSegmentV1 = { type: 'text'; text: string };
export type RoomMessageLinkSegmentV1 = { type: 'link'; href: string; label: string };
export type RoomMessageMentionSegmentV1 = { type: 'mention'; userId: string; label: string };
export type RoomMessageSegmentV1 = RoomMessageTextSegmentV1 | RoomMessageLinkSegmentV1 | RoomMessageMentionSegmentV1;
export type RoomMessageContentV1 = { version: 1; segments: RoomMessageSegmentV1[] };

export const CONTENT_VERSION = 1 as const;
export const MAX_CONTENT_BYTES: number = 16 * 1024;
export const MAX_SEGMENTS: number = 100;
const MAX_TEXT_LENGTH = 8_000;
const MAX_LABEL_LENGTH = 256;
const HTML_TAG = /<\s*\/?\s*[a-z][^>]*>/i;

function cleanString(
  value: unknown,
  maxLength: number,
  { allowEmpty = false }: { allowEmpty?: boolean } = {}
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n?/g, '\n').normalize('NFC');
  if ((!allowEmpty && !normalized) || normalized.length > maxLength || HTML_TAG.test(normalized)) return null;
  return normalized;
}

function cleanHttpUrl(value: unknown): string | null {
  const text = cleanString(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const utf8 = new TextEncoder();

function utf8ByteLength(value: string): number {
  return utf8.encode(value).byteLength;
}

function normalizeSegment(input: unknown): RoomMessageSegmentV1 | null {
  if (!isRecord(input)) return null;
  const segment = input;
  if (segment.type === 'text') {
    const text = cleanString(segment.text, MAX_TEXT_LENGTH, { allowEmpty: true });
    return text === null ? null : { type: 'text', text };
  }
  if (segment.type === 'link') {
    const href = cleanHttpUrl(segment.href);
    const label = cleanString(segment.label, MAX_LABEL_LENGTH);
    return href && label ? { type: 'link', href, label } : null;
  }
  if (segment.type === 'mention') {
    const userId = cleanString(segment.userId, 128);
    const label = cleanString(segment.label, MAX_LABEL_LENGTH);
    return userId && label ? { type: 'mention', userId, label } : null;
  }
  return null;
}

export function normalizeRoomMessageContent(input: unknown): RoomMessageContentV1 | null {
  if (!isRecord(input) || input.version !== CONTENT_VERSION) return null;
  if (!isArray(input.segments) || input.segments.length < 1 || input.segments.length > MAX_SEGMENTS) return null;
  const segments: RoomMessageSegmentV1[] = [];
  for (const item of input.segments) {
    const segment = normalizeSegment(item);
    if (!segment) return null;
    segments.push(segment);
  }
  const normalized: RoomMessageContentV1 = { version: CONTENT_VERSION, segments };
  if (utf8ByteLength(JSON.stringify(normalized)) > MAX_CONTENT_BYTES) return null;
  const text = projectKnownContent(normalized);
  return text.trim() ? normalized : null;
}

function projectKnownContent(content: RoomMessageContentV1): string {
  return content.segments
    .map((segment) => {
      if (segment.type === 'text') return segment.text;
      return segment.label;
    })
    .join('');
}

export function projectRoomMessageContent(value: unknown, plainText: unknown = ''): string {
  const normalized = normalizeRoomMessageContent(value);
  return normalized ? projectKnownContent(normalized) : textOf(plainText);
}

export function contentFromPlainText(value: unknown): RoomMessageContentV1 | null {
  const text = cleanString(value, MAX_TEXT_LENGTH);
  return text ? { version: CONTENT_VERSION, segments: [{ type: 'text', text }] } : null;
}
