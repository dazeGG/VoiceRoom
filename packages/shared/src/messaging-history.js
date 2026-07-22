'use strict';

const HISTORY_CONTRACT_VERSION = 1;
const HISTORY_DEFAULT_LIMIT = 50;
const HISTORY_MAX_LIMIT = 100;
const HISTORY_MODES = Object.freeze(['latest', 'before', 'after', 'around']);
const HISTORY_MODE_SET = new Set(HISTORY_MODES);
const MESSAGE_KIND_SET = new Set(['room', 'dm']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, max = 256) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : '';
}

function isOpaqueCursor(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 4096
    && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/.test(value);
}

function normalizeLimit(value, fallback = HISTORY_DEFAULT_LIMIT) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, HISTORY_MAX_LIMIT);
}

function normalizeHistoryRequest(value = {}) {
  const mode = HISTORY_MODE_SET.has(value.mode) ? value.mode : 'latest';
  const limit = normalizeLimit(value.limit);
  const cursor = isOpaqueCursor(value.cursor) ? value.cursor : '';

  if ((mode === 'before' || mode === 'after' || mode === 'around') && !cursor) {
    return { ok: false, code: 'invalid_cursor' };
  }

  return {
    ok: true,
    request: {
      contractVersion: HISTORY_CONTRACT_VERSION,
      mode,
      limit,
      cursor: mode === 'latest' ? undefined : cursor
    }
  };
}

function normalizeMessageDto(value) {
  if (!isObject(value)) return null;
  const id = cleanString(value.id ?? value.messageId, 160);
  if (!id) return null;

  const kind = MESSAGE_KIND_SET.has(value.kind) ? value.kind : undefined;
  const cursor = isOpaqueCursor(value.cursor) ? value.cursor : undefined;
  const readCursor = isOpaqueCursor(value.readCursor) ? value.readCursor : undefined;

  const normalized = {
    id,
    kind,
    createdAt: value.createdAt ?? null,
    author: isObject(value.author) ? value.author : undefined,
    content: value.content ?? (typeof value.text === 'string' ? { type: 'text', text: value.text } : undefined),
    cursor,
    readCursor
  };
  for (const key of ['attachments', 'editedAt', 'expiresAt', 'metadata', 'readAt', 'recipientId', 'replyPreview', 'replyTo']) {
    if (value[key] !== undefined) normalized[key] = value[key];
  }
  return normalized;
}

function getReadCursorFromMessage(message) {
  const normalized = normalizeMessageDto(message);
  return normalized?.readCursor || '';
}

function normalizeHistoryEnvelope(value) {
  if (!isObject(value)) return { ok: false, code: 'invalid_envelope' };
  if (value.contractVersion !== undefined && value.contractVersion !== HISTORY_CONTRACT_VERSION) {
    return { ok: true, legacy: true, messages: [] };
  }

  const messages = Array.isArray(value.messages)
    ? value.messages.map(normalizeMessageDto).filter(Boolean)
    : [];

  return {
    ok: true,
    legacy: value.contractVersion !== HISTORY_CONTRACT_VERSION,
    envelope: {
      contractVersion: HISTORY_CONTRACT_VERSION,
      mode: HISTORY_MODE_SET.has(value.mode) ? value.mode : 'latest',
      messages,
      pageInfo: {
        before: isOpaqueCursor(value.pageInfo?.before) ? value.pageInfo.before : undefined,
        after: isOpaqueCursor(value.pageInfo?.after) ? value.pageInfo.after : undefined,
        around: isOpaqueCursor(value.pageInfo?.around) ? value.pageInfo.around : undefined,
        hasMoreBefore: Boolean(value.pageInfo?.hasMoreBefore),
        hasMoreAfter: Boolean(value.pageInfo?.hasMoreAfter)
      }
    }
  };
}

function buildHistoryEnvelope({ mode = 'latest', messages = [], pageInfo = {} } = {}) {
  return normalizeHistoryEnvelope({
    contractVersion: HISTORY_CONTRACT_VERSION,
    mode,
    messages,
    pageInfo
  }).envelope;
}

module.exports = {
  HISTORY_CONTRACT_VERSION,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  HISTORY_MODES,
  buildHistoryEnvelope,
  getReadCursorFromMessage,
  isOpaqueCursor,
  normalizeHistoryEnvelope,
  normalizeHistoryRequest,
  normalizeLimit,
  normalizeMessageDto
};
