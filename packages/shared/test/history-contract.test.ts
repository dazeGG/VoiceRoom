import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as history from '../src/messaging-history.ts';

test('G21-A01 history request limits and opaque cursors are exact', () => {
  assert.deepEqual(history.normalizeHistoryRequest({}), {
    ok: true,
    request: { contractVersion: 1, mode: 'latest', limit: 50, cursor: undefined }
  });
  const capped = history.normalizeHistoryRequest({ mode: 'before', limit: 999, cursor: 'opaque.cursor' });
  assert.ok(capped.ok);
  assert.equal(capped.request.limit, 100);
  assert.deepEqual(history.normalizeHistoryRequest({ mode: 'before', cursor: 'not opaque!' }), {
    ok: false,
    code: 'invalid_cursor'
  });
});
