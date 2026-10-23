// Readers for values that arrive untyped (parsed JSON, stored settings, bridge
// answers, database rows): each narrows without a cast.

/** A non-null object that is not an array, read field by field. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An array whose items are still to be checked. */
export function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** True when the value is one of the listed literals. */
export function isOneOf<const T>(values: readonly T[], value: unknown): value is T {
  return values.some((item) => item === value);
}

/** A string, number or boolean as text; '' for a falsy value and for anything else (never "[object Object]"). */
export function textOf(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value) : '';
}

/** The text trimmed; '' when it is not a string or is longer than `max` once trimmed. */
export function trimmedText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length <= max ? text : '';
}

/** A page's cursor info from a stored page: the next cursor only when there is one. */
export function pageInfoOf(nextCursor: unknown, hasMore: unknown): { nextCursor?: string; hasMore: boolean } {
  const cursor = trimmedText(nextCursor, 4096);
  return cursor ? { nextCursor: cursor, hasMore: Boolean(hasMore) } : { hasMore: Boolean(hasMore) };
}

/** A requested page size: a whole number of at least 1, capped at `max`; `fallback` otherwise. */
export function pageLimitOf(value: unknown, fallback: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, max);
}
