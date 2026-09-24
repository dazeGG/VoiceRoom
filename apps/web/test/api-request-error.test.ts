import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('ApiRequestError preserves stable code, room and numeric HTTP status', () => {
  const source = fs.readFileSync(new URL('../src/lib/features/room/client/net/api.ts', import.meta.url), 'utf8');
  assert.match(source, /status: number/);
  assert.match(source, /this\.status = status/);
  assert.match(source, /payload\?\.roomId, response\.status/);
});
