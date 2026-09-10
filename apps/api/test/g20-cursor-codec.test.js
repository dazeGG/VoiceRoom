'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCursorCodec, CursorCodecError } = require('../src/platform/cursor-codec');

test('G20-A01 preserves exact microsecond tuples and accepts the previous rotation key', () => {
  const current = 'c'.repeat(32); const previous = 'p'.repeat(32); const now = 1000;
  const old = createCursorCodec({ keys: [previous], now: () => now, ttlMs: 100 });
  const rotated = createCursorCodec({ keys: [current, previous], now: () => now, ttlMs: 100 });
  const cursor = old.encode({ purpose: 'room-history', context: 'room:a', tuple: { createdAtMicros: '1725000000000001', id: 'm2' } });
  assert.deepEqual(rotated.decode(cursor, { purpose: 'room-history', context: 'room:a' }), { createdAtMicros: '1725000000000001', id: 'm2' });
});

test('G20-A02 tamper, expiry, purpose and context mismatches have one non-oracle error', () => {
  let now = 1000;
  const codec = createCursorCodec({ keys: ['s'.repeat(32)], now: () => now, ttlMs: 10 });
  const cursor = codec.encode({ purpose: 'room-history', context: 'room:a', tuple: { createdAtMicros: '1', id: 'm' } });
  const invalid = [
    [cursor.slice(0, -1) + (cursor.endsWith('a') ? 'b' : 'a'), { purpose: 'room-history', context: 'room:a' }],
    [cursor, { purpose: 'dm-history', context: 'room:a' }],
    [cursor, { purpose: 'room-history', context: 'room:b' }]
  ];
  for (const [value, expected] of invalid) assert.throws(() => codec.decode(value, expected), (error) => error instanceof CursorCodecError && error.code === 'invalid_cursor' && error.statusCode === 400);
  now = 1011;
  assert.throws(() => codec.decode(cursor, { purpose: 'room-history', context: 'room:a' }), { code: 'invalid_cursor', statusCode: 400 });
});
