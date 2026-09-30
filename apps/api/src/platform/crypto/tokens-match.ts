import crypto from 'node:crypto';

/** Constant-time comparison of two session tokens; an empty token never matches. */
export function tokensMatch(expected: string | null | undefined, actual: string | null | undefined): boolean {
  if (!expected || !actual || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
