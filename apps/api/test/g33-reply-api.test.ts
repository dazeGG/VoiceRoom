import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { requireReplyTarget } from '../src/domains/messaging/reply-projector.ts';

test('G33-A01 unavailable and invisible reply targets share one non-disclosing 409', async () => {
  for (const input of [
    { message: null, visibility: true },
    { message: { id: 'm', text: 'secret' }, visibility: false },
    { message: { id: 'm', deletedAt: Date.now() }, visibility: true }
  ]) {
    await assert.rejects(requireReplyTarget(input), (error: { code?: string; statusCode?: number; message?: string }) => error.code === 'reply_target_unavailable' && error.statusCode === 409 && error.message === 'Reply target is unavailable');
  }
});

test('G33-A02 room, guest and DM sends lock reply targets inside the message UoW', () => {
  const roomChat = fs.readFileSync(path.resolve(import.meta.dirname, '../src/domains/messaging/room-chat.service.ts'), 'utf8');
  const directMessages = fs.readFileSync(path.resolve(import.meta.dirname, '../src/domains/messaging/direct-messages.service.ts'), 'utf8');
  assert.match(roomChat, /unitOfWork:[\s\S]*lockRoomTarget/);
  assert.match(directMessages, /unitOfWork:[\s\S]*lockDirectTarget/);
  for (const source of [roomChat, directMessages]) {
    assert.match(source, /replyToMessageId:[\s\S]*beforeUnitOfWork:[\s\S]*unitOfWork/);
    assert.doesNotMatch(source, /replyPreview\.replyPreview/);
  }
});
