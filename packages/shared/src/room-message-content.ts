// Structured room message content (v1): text, link and mention segments,
// capped in size, never HTML, with a plain-text projection for everything
// that shows only text.

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

function cleanString(value: unknown, maxLength: number, { allowEmpty = false }: { allowEmpty?: boolean } = {}): string | null {
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

// Node's Buffer when present (the API), TextEncoder in the browser.
const NodeBuffer = (globalThis as { Buffer?: { byteLength(value: string, encoding: 'utf8'): number } }).Buffer;

function utf8ByteLength(value: string): number {
  if (typeof NodeBuffer !== 'undefined') return NodeBuffer.byteLength(value, 'utf8');
  return new TextEncoder().encode(value).byteLength;
}

function normalizeSegment(input: unknown): RoomMessageSegmentV1 | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const segment = input as Record<string, unknown>;
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
  const value = input as { version?: unknown; segments?: unknown } | null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== CONTENT_VERSION) return null;
  if (!Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > MAX_SEGMENTS) return null;
  const segments = value.segments.map(normalizeSegment);
  if (segments.some((segment) => !segment)) return null;
  const normalized: RoomMessageContentV1 = { version: CONTENT_VERSION, segments: segments as RoomMessageSegmentV1[] };
  if (utf8ByteLength(JSON.stringify(normalized)) > MAX_CONTENT_BYTES) return null;
  const text = projectKnownContent(normalized);
  return text.trim() ? normalized : null;
}

function projectKnownContent(content: RoomMessageContentV1): string {
  return content.segments.map((segment) => {
    if (segment.type === 'text') return segment.text;
    return segment.label;
  }).join('');
}

export function projectRoomMessageContent(value: unknown, legacyText: unknown = ''): string {
  const normalized = normalizeRoomMessageContent(value);
  return normalized ? projectKnownContent(normalized) : String(legacyText || '');
}

export function contentFromLegacyText(value: unknown): RoomMessageContentV1 | null {
  const text = cleanString(value, MAX_TEXT_LENGTH);
  return text ? { version: CONTENT_VERSION, segments: [{ type: 'text', text }] } : null;
}
