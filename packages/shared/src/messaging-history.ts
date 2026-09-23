// Paginated message history (room and DM): the page request a client sends,
// the message DTO, and the envelope with opaque cursors in both directions.

export const HISTORY_CONTRACT_VERSION = 1 as const;
export const HISTORY_DEFAULT_LIMIT = 50 as const;
export const HISTORY_MAX_LIMIT = 100 as const;

export type HistoryMode = 'latest' | 'before' | 'after' | 'around';
export const HISTORY_MODES: readonly ['latest', 'before', 'after', 'around'] = Object.freeze(['latest', 'before', 'after', 'around'] as const);

export type HistoryRequest = {
  contractVersion: 1;
  mode: HistoryMode;
  limit: number;
  cursor?: string;
};

export type MessageDto = {
  id: string;
  kind?: 'room' | 'dm';
  createdAt: unknown;
  author?: Record<string, unknown>;
  content?: unknown;
  cursor?: string;
  readCursor?: string;
  attachments?: unknown;
  editedAt?: unknown;
  expiresAt?: unknown;
  metadata?: unknown;
  readAt?: unknown;
  recipientId?: unknown;
  replyPreview?: unknown;
  replyTo?: unknown;
};

export type HistoryEnvelope = {
  contractVersion: 1;
  mode: HistoryMode;
  messages: MessageDto[];
  pageInfo: {
    before?: string;
    after?: string;
    around?: string;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
  };
};

type Loose = Record<string, unknown>;

const HISTORY_MODE_SET = new Set<unknown>(HISTORY_MODES);
const MESSAGE_KIND_SET = new Set<unknown>(['room', 'dm']);
const OPTIONAL_MESSAGE_FIELDS = ['attachments', 'editedAt', 'expiresAt', 'metadata', 'readAt', 'recipientId', 'replyPreview', 'replyTo'] as const;

function isObject(value: unknown): value is Loose {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown, max = 256): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : '';
}

export function isOpaqueCursor(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 4096
    && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/.test(value);
}

export function normalizeLimit(value: unknown, fallback: number = HISTORY_DEFAULT_LIMIT): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, HISTORY_MAX_LIMIT);
}

export function normalizeHistoryRequest(value: Loose = {}):
  | { ok: true; request: HistoryRequest }
  | { ok: false; code: string } {
  const mode = HISTORY_MODE_SET.has(value.mode) ? value.mode as HistoryMode : 'latest';
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

export function normalizeMessageDto(value: unknown): MessageDto | null {
  if (!isObject(value)) return null;
  const id = cleanString(value.id ?? value.messageId, 160);
  if (!id) return null;

  const kind = MESSAGE_KIND_SET.has(value.kind) ? value.kind as 'room' | 'dm' : undefined;
  const cursor = isOpaqueCursor(value.cursor) ? value.cursor : undefined;
  const readCursor = isOpaqueCursor(value.readCursor) ? value.readCursor : undefined;

  const normalized: MessageDto = {
    id,
    kind,
    createdAt: value.createdAt ?? null,
    author: isObject(value.author) ? value.author : undefined,
    content: value.content ?? (typeof value.text === 'string' ? { type: 'text', text: value.text } : undefined),
    cursor,
    readCursor
  };
  for (const key of OPTIONAL_MESSAGE_FIELDS) {
    if (value[key] !== undefined) normalized[key] = value[key];
  }
  return normalized;
}

export function getReadCursorFromMessage(message: unknown): string {
  const normalized = normalizeMessageDto(message);
  return normalized?.readCursor || '';
}

export function normalizeHistoryEnvelope(value: unknown):
  | { ok: true; legacy: boolean; envelope: HistoryEnvelope }
  | { ok: true; legacy: true; messages: [] }
  | { ok: false; code: string } {
  if (!isObject(value)) return { ok: false, code: 'invalid_envelope' };
  if (value.contractVersion !== undefined && value.contractVersion !== HISTORY_CONTRACT_VERSION) {
    return { ok: true, legacy: true, messages: [] };
  }

  const messages = Array.isArray(value.messages)
    ? value.messages.map(normalizeMessageDto).filter((message): message is MessageDto => Boolean(message))
    : [];
  const pageInfo = value.pageInfo as Loose | undefined;

  return {
    ok: true,
    legacy: value.contractVersion !== HISTORY_CONTRACT_VERSION,
    envelope: {
      contractVersion: HISTORY_CONTRACT_VERSION,
      mode: HISTORY_MODE_SET.has(value.mode) ? value.mode as HistoryMode : 'latest',
      messages,
      pageInfo: {
        before: isOpaqueCursor(pageInfo?.before) ? pageInfo.before : undefined,
        after: isOpaqueCursor(pageInfo?.after) ? pageInfo.after : undefined,
        around: isOpaqueCursor(pageInfo?.around) ? pageInfo.around : undefined,
        hasMoreBefore: Boolean(pageInfo?.hasMoreBefore),
        hasMoreAfter: Boolean(pageInfo?.hasMoreAfter)
      }
    }
  };
}

export function buildHistoryEnvelope({ mode = 'latest', messages = [], pageInfo = {} }: {
  mode?: HistoryMode;
  messages?: unknown[];
  pageInfo?: Record<string, unknown>;
} = {}): HistoryEnvelope {
  const result = normalizeHistoryEnvelope({ contractVersion: HISTORY_CONTRACT_VERSION, mode, messages, pageInfo });
  return (result as { envelope: HistoryEnvelope }).envelope;
}
