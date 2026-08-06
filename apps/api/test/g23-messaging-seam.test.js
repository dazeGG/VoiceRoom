'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createMessageService } = require('../src/domains/messaging/message-service');
const { createMessageVisibilityService } = require('../src/domains/messaging/message-visibility-service');

test('G23-A01 message UoW exposes unchanged repositories and exactly one visibility policy', async () => {
  const room = {}; const direct = {}; const visibility = createMessageVisibilityService();
  const service = createMessageService({ roomMessages: room, directMessages: direct, visibility });
  const result = await service.withUnitOfWork((uow) => uow);
  assert.equal(service.room, room); assert.equal(service.direct, direct); assert.equal(service.visibility, visibility);
  assert.equal(result.roomMessages, room); assert.equal(result.directMessages, direct); assert.equal(result.visibility, visibility);
});

test('G23-A02 repository contains one canonical visibility service implementation', () => {
  const root = path.resolve(__dirname, '../src');
  const candidates = [];
  for (const dir of ['domains/messaging', 'domains/notifications', 'domains/media']) {
    for (const name of fs.readdirSync(path.join(root, dir))) if (/message-visibility-service\.js$/.test(name)) candidates.push(path.join(dir, name));
  }
  assert.equal(candidates.length, 1);
  assert.match(candidates[0], /domains[\\/]messaging[\\/]message-visibility-service\.js$/);
});
