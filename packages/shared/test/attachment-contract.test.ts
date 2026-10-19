import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_ATTACHMENT_BYTES,
  attachmentTextFallback,
  normalizeAttachment,
  normalizeAttachments
} from '../src/attachments.ts';
import { defined } from './helpers/assert-defined.ts';

const attachment = (overrides = {}) => ({
  id: 'a',
  context: 'room',
  ownerId: 'owner',
  order: 0,
  mimeType: 'image/jpeg',
  bytes: MAX_ATTACHMENT_BYTES,
  width: 4000,
  height: 3000,
  state: 'ready',
  url: '/private',
  ...overrides
});

test('G72-A01 room/DM attachments validate owner, order, dimensions, bytes and safe unknown state', () => {
  assert.equal(defined(normalizeAttachment(attachment()), 'the attachment').state, 'ready');
  assert.equal(
    defined(normalizeAttachment(attachment({ context: 'dm', state: 'future' })), 'the attachment').state,
    'unavailable'
  );
  for (const invalid of [
    { ownerId: '' },
    { context: 'other' },
    { order: 4 },
    { bytes: MAX_ATTACHMENT_BYTES + 1 },
    { width: 0 },
    { height: 16385 },
    { mimeType: 'image/gif' }
  ])
    assert.equal(normalizeAttachment(attachment(invalid)), null);
  assert.equal(defined(normalizeAttachment(attachment({ state: 'failed' })), 'the attachment').url, null);
});

test('G72-A02 max four attachments and image-only legacy fallback are deterministic', () => {
  assert.deepEqual(normalizeAttachments([]), []);
  const four = Array.from({ length: 4 }, (_, order) => attachment({ id: `a-${order}`, order }));
  assert.equal(defined(normalizeAttachments(four), 'the attachments').length, 4);
  assert.equal(normalizeAttachments([...four, attachment({ id: 'fifth' })]), null);
  assert.equal(normalizeAttachments([attachment(), attachment({ id: 'duplicate-order' })]), null);
  assert.equal(attachmentTextFallback(four, ''), '[Изображения: 4]');
  assert.equal(attachmentTextFallback(four, ' caption '), 'caption');
});
