import type { IncomingMessage } from 'node:http';

export type RateDecision = { allowed: boolean; retryAfterSeconds: number };
type Entry = { count: number; startedAt: number };

// Resolves the client IP. When trustProxy is enabled the last hop of
// X-Forwarded-For is used (the IP the trusted reverse proxy observed);
// otherwise the direct socket address is used so clients cannot spoof it.
function getClientIp(req: Pick<IncomingMessage, 'socket' | 'headers'>, trustProxy: unknown): string {
  if (!trustProxy) {
    return req.socket.remoteAddress || 'unknown';
  }

  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const forwardedIps = String(forwardedValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const forwardedIp = forwardedIps.at(-1);
  return forwardedIp || req.socket.remoteAddress || 'unknown';
}

// Fixed-window per-key rate limiter. A limit or window of <= 0 disables it.
function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const entries = new Map<string, Entry>();
  let lastPruneAt = 0;

  function check(key: string, now: number = Date.now()): RateDecision {
    if (limit <= 0 || windowMs <= 0) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (now - lastPruneAt >= windowMs) {
      for (const [entryKey, entry] of entries) {
        if (now - entry.startedAt > windowMs) entries.delete(entryKey);
      }
      lastPruneAt = now;
    }

    const current = entries.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      entries.set(key, { count: 1, startedAt: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    current.count += 1;
    const retryAfterSeconds = Math.ceil((windowMs - (now - current.startedAt)) / 1000);
    return { allowed: current.count <= limit, retryAfterSeconds };
  }

  return { check, entries };
}

// Counts only failures per key (for example failed logins per account), so an
// attacker spread across many addresses still hits a ceiling on one account,
// while the owner's successful sign-in clears the count. A limit or window of
// <= 0 disables it.
function createFailureLimiter({ limit, windowMs, maxEntries = 100_000 }: { limit: number; windowMs: number; maxEntries?: number }) {
  const entries = new Map<string, Entry>();
  let lastSweepAt = 0;

  // Keys are attacker-chosen (any submitted login), so expired entries are
  // swept every window and the map is capped outright.
  function sweep(now: number): void {
    if (now - lastSweepAt < windowMs && entries.size < maxEntries) return;
    lastSweepAt = now;
    for (const [key, entry] of entries) {
      if (now - entry.startedAt >= windowMs) entries.delete(key);
    }
    while (entries.size >= maxEntries) entries.delete(entries.keys().next().value as string);
  }

  function current(key: string, now: number): Entry | null {
    const entry = entries.get(key);
    if (!entry) return null;
    if (now - entry.startedAt >= windowMs) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  function status(key: string, now: number = Date.now()): RateDecision {
    if (limit <= 0 || windowMs <= 0) return { allowed: true, retryAfterSeconds: 0 };
    const entry = current(key, now);
    if (!entry || entry.count < limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.ceil((windowMs - (now - entry.startedAt)) / 1000) };
  }

  function recordFailure(key: string, now: number = Date.now()): void {
    if (limit <= 0 || windowMs <= 0) return;
    sweep(now);
    const entry = current(key, now);
    if (entry) entry.count += 1;
    else entries.set(key, { count: 1, startedAt: now });
  }

  function reset(key: string): void {
    entries.delete(key);
  }

  // Counts an attempt before the slow credential check, so a parallel burst
  // cannot slip more guesses past status() than the limit allows. A success
  // calls reset(); a failure keeps the reserved count.
  function reserve(key: string, now: number = Date.now()): RateDecision {
    const allowed = status(key, now);
    if (!allowed.allowed) return allowed;
    recordFailure(key, now);
    return allowed;
  }

  return { entries, recordFailure, reserve, reset, status };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
export type FailureLimiter = ReturnType<typeof createFailureLimiter>;

export { getClientIp, createFailureLimiter, createRateLimiter };
