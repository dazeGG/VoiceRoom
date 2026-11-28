import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from 'typebox/value';
import {
  AttachmentDraft,
  DIAGNOSTICS_FILE_NAME_PATTERN,
  DIAGNOSTICS_MAX_BYTES,
  diagnosticsFileName
} from '../src/contracts/media.ts';
import { Attachment } from '../src/contracts/messages.ts';

test('the diagnostics file is named by its local date and minute', () => {
  const name = diagnosticsFileName(new Date(2026, 10, 27, 14, 2, 59));
  assert.equal(name, 'voiceroom-diagnostics-2026-11-27-1402.txt');
  assert.match(name, DIAGNOSTICS_FILE_NAME_PATTERN);
  assert.equal(DIAGNOSTICS_MAX_BYTES, 524_288);
});

test('the name pattern takes only the diagnostics file', () => {
  for (const name of ['voiceroom-diagnostics-2026-11-27-140259.txt', 'voiceroom-diagnostics-2026-01-02-0000.txt']) {
    assert.match(name, DIAGNOSTICS_FILE_NAME_PATTERN);
  }
  for (const name of [
    'diagnostics.txt',
    'voiceroom-diagnostics-2026-11-27-1402.txt.html',
    'voiceroom-diagnostics-2026-11-27.txt',
    '../voiceroom-diagnostics-2026-11-27-1402.txt',
    'voiceroom-diagnostics-2026-11-27-1402.TXT'
  ]) {
    assert.doesNotMatch(name, DIAGNOSTICS_FILE_NAME_PATTERN);
  }
});

const image = {
  id: 'a',
  context: 'dm',
  order: 0,
  mimeType: 'image/webp',
  bytes: 10,
  width: 1,
  height: 1,
  state: 'ready',
  url: '/api/media/attachments/a/preview'
};

test('an attachment from a 1.5.0 server, without kind and name, still matches', () => {
  assert.ok(Value.Check(Attachment, image));
  assert.ok(
    Value.Check(AttachmentDraft, {
      id: 'a',
      context: 'dm',
      state: 'ready',
      mimeType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
      failureCode: null,
      createdAt: 1,
      updatedAt: 1
    })
  );
});

test('a diagnostics attachment carries its kind and name, and no other kind is accepted', () => {
  const file = {
    ...image,
    mimeType: 'text/plain',
    width: null,
    height: null,
    kind: 'diagnostics',
    name: 'voiceroom-diagnostics-2026-11-27-1402.txt'
  };
  assert.ok(Value.Check(Attachment, file));
  assert.equal(Value.Check(Attachment, { ...file, kind: 'video' }), false);
});
