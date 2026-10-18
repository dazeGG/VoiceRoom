// Paginated message history (room and DM): the page request a client sends
// and its opaque cursors. The page itself is contracts/messages.ts.

import type { HistoryMode } from './contracts/messages.ts';

export const HISTORY_CONTRACT_VERSION = 1 as const;
export const HISTORY_DEFAULT_LIMIT = 50 as const;
export const HISTORY_MAX_LIMIT = 100 as const;

export const HISTORY_MODES: readonly HistoryMode[] = Object.freeze(['latest', 'before', 'after', 'around'] as const);

export type HistoryRequest = {
  contractVersion: 1;
  mode: HistoryMode;
  limit: number;
  cursor?: string;
};

type Loose = Record<string, unknown>;

export function isOpaqueCursor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/.test(value)
  );
}

export function normalizeLimit(value: unknown, fallback: number = HISTORY_DEFAULT_LIMIT): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, HISTORY_MAX_LIMIT);
}

export function normalizeHistoryRequest(
  value: Loose = {}
): { ok: true; request: HistoryRequest } | { ok: false; code: 'invalid_cursor' } {
  const mode = HISTORY_MODES.find((candidate) => candidate === value.mode) ?? 'latest';
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
