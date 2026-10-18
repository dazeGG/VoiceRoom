// An HTTP answer or realtime frame this build's contract rejects. The likely
// cause is a server deployed after this tab loaded, so the app looks for a new
// version (routes/+layout.svelte). However many frames fail, that look happens
// at most once a minute: one mismatch on a frequent event in every open tab
// must not turn into a storm of version checks.

import { createLogger } from '$lib/shared/log';

const log = createLogger('contract');

const VERSION_CHECK_INTERVAL_MS = 60_000;

const handlers = new Set<() => void>();
let lastCheckAt = Number.NEGATIVE_INFINITY;

/** Logs what did not match and, at most once a minute, tells the handlers. */
export function reportContractViolation(source: 'http' | 'realtime', detail: Record<string, string | number>): void {
  log.warn('server data outside the contract', { source, ...detail });
  const now = Date.now();
  if (now - lastCheckAt < VERSION_CHECK_INTERVAL_MS) return;
  lastCheckAt = now;
  for (const handler of handlers) handler();
}

export function onContractViolation(handler: () => void): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
