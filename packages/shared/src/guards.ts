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
