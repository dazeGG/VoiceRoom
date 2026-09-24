import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createMessageService } from '../src/domains/messaging/message-service.ts';
import { createMessageVisibilityService } from '../src/domains/messaging/message-visibility-service.ts';

test('G23-A01 message UoW exposes unchanged repositories and exactly one visibility policy', async () => {
  const room = {}; const direct = {}; const visibility = createMessageVisibilityService();
  const service = createMessageService({ roomMessages: room, directMessages: direct, visibility });
  const result = await service.withUnitOfWork((uow) => uow);
  assert.equal(service.room, room); assert.equal(service.direct, direct); assert.equal(service.visibility, visibility);
  assert.equal(result.roomMessages, room); assert.equal(result.directMessages, direct); assert.equal(result.visibility, visibility);
});

test('G23-A02 repository contains one canonical visibility service implementation', () => {
  const root = path.resolve(import.meta.dirname, '../src');
  const candidates = [];
  for (const dir of ['domains/messaging', 'domains/notifications', 'domains/media']) {
    for (const name of fs.readdirSync(path.join(root, dir))) if (/message-visibility-service\.(?:js|ts)$/.test(name)) candidates.push(path.join(dir, name));
  }
  assert.equal(candidates.length, 1);
  assert.match(candidates[0]!, /domains[\\/]messaging[\\/]message-visibility-service\.ts$/);
});
