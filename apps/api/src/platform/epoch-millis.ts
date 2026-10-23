// Every time the API sends is epoch milliseconds. Repositories hand over
// what the driver returns: a Date, an ISO string or a number.

export function epochMillis(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Epoch milliseconds as a Date for a query or a row; throws on a non-finite or negative value. */
export function toDate(ms: number): Date {
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`Not an epoch time: ${ms}`);
  return new Date(ms);
}

/** A stored time as epoch milliseconds; throws when the driver value does not parse (never 0, never now). */
export function toMillis(value: Date | string | number): number {
  const ms = epochMillis(value);
  if (ms === null) throw new RangeError(`Not a stored time: ${String(value)}`);
  return ms;
}
