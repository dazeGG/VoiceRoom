// What an admin section shows instead of its numbers when a load fails.

import { ApiError } from '$lib/api/client';

export type LoadFailure = { kind: 'signed_out' | 'forbidden' | 'failed'; message: string };

export function loadFailure(cause: unknown, fallback: string): LoadFailure {
  if (cause instanceof ApiError && cause.status === 401) return { kind: 'signed_out', message: '' };
  if (cause instanceof ApiError && cause.status === 403) return { kind: 'forbidden', message: '' };
  return { kind: 'failed', message: cause instanceof Error && cause.message ? cause.message : fallback };
}
