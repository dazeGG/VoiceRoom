// Spans turn into the days and moments the server is asked for.

import { expect, test } from 'vitest';
import {
  PRODUCT_PRESETS,
  SYSTEM_PRESETS,
  fromInputValue,
  moscowDay,
  productQuery,
  rangeLabel,
  systemQuery,
  toInputValue
} from '../src/time-range.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test('spans turn into the days and moments the server is asked for', () => {
  const now = Date.parse('2026-10-16T10:00:00Z');
  expect(moscowDay(Date.parse('2026-10-15T21:30:00Z'))).toBe('2026-10-16');
  expect(productQuery({ kind: 'preset', id: '7d' }, PRODUCT_PRESETS, now)).toEqual({
    from: '2026-10-10',
    to: '2026-10-16'
  });
  expect(productQuery({ kind: 'preset', id: 'all' }, PRODUCT_PRESETS, now)).toEqual({
    from: '2000-01-01',
    to: '2026-10-16'
  });
  expect(
    productQuery({ kind: 'custom', from: Date.parse('2026-10-01T09:00:00Z'), to: now }, PRODUCT_PRESETS, now)
  ).toEqual({
    from: '2026-10-01',
    to: '2026-10-16'
  });
  expect(systemQuery({ kind: 'preset', id: '3h' }, SYSTEM_PRESETS, now)).toEqual({
    from: String(now - 3 * HOUR),
    to: String(now)
  });
  expect(systemQuery({ kind: 'custom', from: 1, to: 2 }, SYSTEM_PRESETS, now)).toEqual({ from: '1', to: '2' });
  // An unknown preset falls back to a day.
  expect(systemQuery({ kind: 'preset', id: 'gone' }, SYSTEM_PRESETS, now)).toEqual({
    from: String(now - DAY),
    to: String(now)
  });
});

test('a span is named, and an input value round-trips through a moment', () => {
  expect(rangeLabel({ kind: 'preset', id: '6h' }, SYSTEM_PRESETS, true)).toBe('Последние 6 часов');
  expect(rangeLabel({ kind: 'preset', id: 'gone' }, SYSTEM_PRESETS, true)).toBe('gone');
  const local = new Date(2026, 9, 16, 9, 5).getTime();
  expect(toInputValue(local, true)).toBe('2026-10-16T09:05');
  expect(toInputValue(local, false)).toBe('2026-10-16');
  expect(fromInputValue('2026-10-16T09:05', true)).toBe(local);
  expect(fromInputValue('', true)).toBeNull();
  expect(fromInputValue('not a date', false)).toBeNull();
});
