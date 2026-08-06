'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { requireReplyTarget } = require('../src/domains/messaging/reply-projector');

test('G33-A01 unavailable and invisible reply targets share one non-disclosing 409', async () => {
  for (const input of [
    { message: null, visibility: true },
    { message: { id: 'm', text: 'secret' }, visibility: false },
    { message: { id: 'm', deletedAt: Date.now() }, visibility: true }
  ]) {
    await assert.rejects(requireReplyTarget(input), (error) => error.code === 'reply_target_unavailable' && error.statusCode === 409 && error.message === 'Reply target is unavailable');
  }
});

test('G33-A02 room, guest and DM sends lock reply targets inside the message UoW', () => {
  const server = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');
  assert.match(server, /unitOfWork:[\s\S]*lockRoomTarget/);
  assert.match(server, /unitOfWork:[\s\S]*lockDirectTarget/);
  assert.match(server, /replyToMessageId:[\s\S]*beforeUnitOfWork:[\s\S]*unitOfWork/);
  assert.doesNotMatch(server, /replyPreview\.replyPreview/);
});
