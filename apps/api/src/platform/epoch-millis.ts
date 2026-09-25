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
