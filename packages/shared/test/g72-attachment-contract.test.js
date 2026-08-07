'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { MAX_ATTACHMENT_BYTES, attachmentTextFallback, normalizeAttachment, normalizeAttachments } = require('../src/attachments');

const attachment = (overrides = {}) => ({ id: 'a', context: 'room', ownerId: 'owner', order: 0,
  mimeType: 'image/jpeg', bytes: MAX_ATTACHMENT_BYTES, width: 4000, height: 3000, state: 'ready', url: '/private', ...overrides });

test('G72-A01 room/DM attachments validate owner, order, dimensions, bytes and safe unknown state', () => {
  assert.equal(normalizeAttachment(attachment()).state, 'ready');
  assert.equal(normalizeAttachment(attachment({ context: 'dm', state: 'future' })).state, 'unavailable');
  for (const invalid of [
    { ownerId: '' }, { context: 'other' }, { order: 4 }, { bytes: MAX_ATTACHMENT_BYTES + 1 },
    { width: 0 }, { height: 16385 }, { mimeType: 'image/gif' }
  ]) assert.equal(normalizeAttachment(attachment(invalid)), null);
  assert.equal(normalizeAttachment(attachment({ state: 'failed' })).url, null);
});

test('G72-A02 max four attachments and image-only legacy fallback are deterministic', () => {
  assert.deepEqual(normalizeAttachments([]), []);
  const four = Array.from({ length: 4 }, (_, order) => attachment({ id: `a-${order}`, order }));
  assert.equal(normalizeAttachments(four).length, 4);
  assert.equal(normalizeAttachments([...four, attachment({ id: 'fifth' })]), null);
  assert.equal(normalizeAttachments([attachment(), attachment({ id: 'duplicate-order' })]), null);
  assert.equal(attachmentTextFallback(four, ''), '[Изображения: 4]');
  assert.equal(attachmentTextFallback(four, ' caption '), 'caption');
});
