'use strict';

const CONTENT_VERSION = 1;
const MAX_CONTENT_BYTES = 16 * 1024;
const MAX_SEGMENTS = 100;
const MAX_TEXT_LENGTH = 8_000;
const MAX_LABEL_LENGTH = 256;
const HTML_TAG = /<\s*\/?\s*[a-z][^>]*>/i;

function cleanString(value, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n?/g, '\n').normalize('NFC');
  if ((!allowEmpty && !normalized) || normalized.length > maxLength || HTML_TAG.test(normalized)) return null;
  return normalized;
}

function cleanHttpUrl(value) {
  const text = cleanString(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function utf8ByteLength(value) {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(value, 'utf8');
  return new TextEncoder().encode(value).byteLength;
}

function normalizeSegment(segment) {
  if (!segment || typeof segment !== 'object' || Array.isArray(segment)) return null;
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

function normalizeRoomMessageContent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== CONTENT_VERSION) return null;
  if (!Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > MAX_SEGMENTS) return null;
  const segments = value.segments.map(normalizeSegment);
  if (segments.some((segment) => !segment)) return null;
  const normalized = { version: CONTENT_VERSION, segments };
  if (utf8ByteLength(JSON.stringify(normalized)) > MAX_CONTENT_BYTES) return null;
  const text = projectKnownContent(normalized);
  return text.trim() ? normalized : null;
}

function projectKnownContent(content) {
  return content.segments.map((segment) => {
    if (segment.type === 'text') return segment.text;
    return segment.label;
  }).join('');
}

function projectRoomMessageContent(value, legacyText = '') {
  const normalized = normalizeRoomMessageContent(value);
  return normalized ? projectKnownContent(normalized) : String(legacyText || '');
}

function contentFromLegacyText(value) {
  const text = cleanString(value, MAX_TEXT_LENGTH);
  return text ? { version: CONTENT_VERSION, segments: [{ type: 'text', text }] } : null;
}

module.exports = {
  CONTENT_VERSION,
  MAX_CONTENT_BYTES,
  MAX_SEGMENTS,
  contentFromLegacyText,
  normalizeRoomMessageContent,
  projectRoomMessageContent
};
