'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const history = require('../src/messaging-history');

test('G21-A01 history request limits and opaque cursors are exact', () => {
  assert.deepEqual(history.normalizeHistoryRequest({}), { ok: true, request: { contractVersion: 1, mode: 'latest', limit: 50, cursor: undefined } });
  assert.equal(history.normalizeHistoryRequest({ mode: 'before', limit: 999, cursor: 'opaque.cursor' }).request.limit, 100);
  assert.deepEqual(history.normalizeHistoryRequest({ mode: 'before', cursor: 'not opaque!' }), { ok: false, code: 'invalid_cursor' });
});

test('G21-A02 read cursors originate only from normalized message DTOs and future envelopes fall back', () => {
  assert.equal(history.getReadCursorFromMessage({ id: 'm', readCursor: 'opaque_cursor' }), 'opaque_cursor');
  assert.equal(history.getReadCursorFromMessage({ readCursor: 'opaque_cursor' }), '');
  assert.deepEqual(history.normalizeHistoryEnvelope({ contractVersion: 99, messages: [{ id: 'm' }] }), { ok: true, legacy: true, messages: [] });
});
