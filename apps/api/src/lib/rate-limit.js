'use strict';

// Resolves the client IP. When trustProxy is enabled the last hop of
// X-Forwarded-For is used (the IP the trusted reverse proxy observed);
// otherwise the direct socket address is used so clients cannot spoof it.
function getClientIp(req, trustProxy) {
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
function createRateLimiter({ limit, windowMs }) {
  const entries = new Map();

  function check(key, now = Date.now()) {
    if (limit <= 0 || windowMs <= 0) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    for (const [entryKey, entry] of entries) {
      if (now - entry.startedAt > windowMs) entries.delete(entryKey);
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

module.exports = { getClientIp, createRateLimiter };
