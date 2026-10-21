// What a section shows instead of its numbers when a load fails.

import { ApiError } from './api/client.ts';

export type LoadFailure = { kind: 'forbidden' | 'failed'; message: string };

export function loadFailure(cause: unknown, fallback: string): LoadFailure {
  if (cause instanceof ApiError && cause.status === 403) return { kind: 'forbidden', message: '' };
  return { kind: 'failed', message: cause instanceof Error && cause.message ? cause.message : fallback };
}
