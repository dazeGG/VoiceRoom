export const HISTORY_CONTRACT_VERSION: 1;
export const HISTORY_DEFAULT_LIMIT: 50;
export const HISTORY_MAX_LIMIT: 100;
export const HISTORY_MODES: readonly ['latest', 'before', 'after', 'around'];

export type HistoryMode = 'latest' | 'before' | 'after' | 'around';

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

export function buildHistoryEnvelope(input?: {
  mode?: HistoryMode;
  messages?: unknown[];
  pageInfo?: Record<string, unknown>;
}): HistoryEnvelope;
export function getReadCursorFromMessage(message: unknown): string;
export function isOpaqueCursor(value: unknown): boolean;
export function normalizeHistoryEnvelope(value: unknown):
  | { ok: true; legacy: boolean; envelope: HistoryEnvelope }
  | { ok: true; legacy: true; messages: [] }
  | { ok: false; code: string };
export function normalizeHistoryRequest(value?: Record<string, unknown>):
  | { ok: true; request: HistoryRequest }
  | { ok: false; code: string };
export function normalizeLimit(value: unknown, fallback?: number): number;
export function normalizeMessageDto(value: unknown): MessageDto | null;
