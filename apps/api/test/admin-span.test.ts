// The spans the admin panel asks for, as the server settles them: product days
// stay between the first account and today, server minutes inside the kept
// window, and the bucket size gives a chart a readable number of points.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PRODUCT_DAYS } from '@voice-room/shared/contracts/admin';
import { moscowDay, productSpan, systemSpan } from '../src/domains/admin/admin.service.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test('a Moscow day turns over three hours before UTC midnight', () => {
  assert.equal(moscowDay(Date.parse('2026-10-15T20:59:59Z')), '2026-10-15');
  assert.equal(moscowDay(Date.parse('2026-10-15T21:00:00Z')), '2026-10-16');
});

test('product days default to the last 30, never pass today and never start before the first account', () => {
  assert.deepEqual(productSpan({}, '2026-10-16', null), { from: '2026-09-17', to: '2026-10-16' });
  assert.deepEqual(productSpan({}, '2026-10-16', '2026-10-01'), { from: '2026-10-01', to: '2026-10-16' });
  assert.deepEqual(productSpan({ from: '2026-10-10', to: '2027-01-01' }, '2026-10-16', null), {
    from: '2026-10-10',
    to: '2026-10-16'
  });
  // Reversed ends are swapped before anything else.
  assert.deepEqual(productSpan({ from: '2026-10-12', to: '2026-10-02' }, '2026-10-16', null), {
    from: '2026-10-02',
    to: '2026-10-12'
  });
  // A span wholly before the first account shrinks to its last day.
  assert.deepEqual(productSpan({ from: '2026-01-01', to: '2026-02-01' }, '2026-10-16', '2026-06-29'), {
    from: '2026-02-01',
    to: '2026-02-01'
  });
  // A day that does not exist is ignored, not rolled into the next month.
  assert.deepEqual(productSpan({ from: '2026-02-31', to: '2026-10-16' }, '2026-10-16', null), {
    from: '2026-09-17',
    to: '2026-10-16'
  });
  const long = productSpan({ from: '2000-01-01' }, '2026-10-16', null);
  const days = (Date.parse(long.to) - Date.parse(long.from)) / DAY + 1;
  assert.equal(days, MAX_PRODUCT_DAYS);
});

test('server spans stay inside the kept minutes and get about 360 points', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  assert.deepEqual(systemSpan({}, now), { from: now - DAY, to: now, bucketSeconds: 300 });
  assert.deepEqual(systemSpan({ from: String(now - HOUR), to: String(now) }, now), {
    from: now - HOUR,
    to: now,
    bucketSeconds: 60
  });
  const week = systemSpan({ from: String(now - 7 * DAY) }, now);
  assert.equal(week.bucketSeconds, 1800);
  // Older than the kept 30 days starts at the oldest kept minute.
  const year = systemSpan({ from: String(now - 365 * DAY), to: String(now) }, now);
  assert.equal(year.from, now - 30 * DAY);
  assert.equal(year.bucketSeconds, 7200);
  // Reversed, and the end clamped to now.
  assert.deepEqual(systemSpan({ from: String(now + DAY), to: String(now - 2 * HOUR) }, now), {
    from: now - 2 * HOUR,
    to: now,
    bucketSeconds: 60
  });
  // A span shorter than five minutes grows to five.
  const blink = systemSpan({ from: String(now - 1000), to: String(now) }, now);
  assert.equal(blink.to - blink.from, 5 * 60_000);
  // Wholly before the kept window: an empty end of it, not an error.
  const ancient = systemSpan({ from: String(now - 90 * DAY), to: String(now - 60 * DAY) }, now);
  assert.equal(ancient.to - ancient.from, 5 * 60_000);
});
