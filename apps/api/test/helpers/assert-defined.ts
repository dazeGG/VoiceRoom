import assert from 'node:assert/strict';

/**
 * The value, or a failed assertion naming what was missing: for an array item,
 * a map entry or an optional field a test relies on being there.
 */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new assert.AssertionError({ message: `expected ${what}, got ${String(value)}`, actual: value });
  }
  return value;
}
