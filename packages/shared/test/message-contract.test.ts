import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from 'typebox/value';
import { MAX_ATTACHMENTS, PostRoomMessageBody, SendDirectMessageBody } from '../src/contracts/messages.ts';

test('message bodies carry at most MAX_ATTACHMENTS attachment ids', () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `attachment-${String(index)}`);
  for (const schema of [PostRoomMessageBody, SendDirectMessageBody]) {
    assert.equal(Value.Check(schema, { text: 'hi', attachmentIds: ids(MAX_ATTACHMENTS) }), true);
    assert.equal(Value.Check(schema, { text: 'hi', attachmentIds: ids(MAX_ATTACHMENTS + 1) }), false);
  }
});
