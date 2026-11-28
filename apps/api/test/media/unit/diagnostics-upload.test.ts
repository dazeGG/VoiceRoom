// The diagnostics file in the media service, the visibility check and the
// message projection, with the repository faked: what a raced or nameless
// upload answers, which parts of the name and type are tolerated, and that an
// opened file is never an image (and an image never a file).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import type { Attachment, AttachmentRepository } from '../../../src/domains/media/attachment.repository.ts';
import type { MediaJobRepository } from '../../../src/domains/media/media-job.repository.ts';
import type { MediaPressureService } from '../../../src/domains/media/media-pressure.service.ts';
import type { MediaQuotaService } from '../../../src/domains/media/media-quota.service.ts';
import { createMediaService } from '../../../src/domains/media/media.service.ts';
import {
  createMediaVisibilityService,
  openedMediaHeaders
} from '../../../src/domains/media/media-visibility.service.ts';
import { createMediaStorage } from '../../../src/domains/media/storage.ts';
import { publicAttachment } from '../../../src/domains/messaging/message-projection.ts';
import { attachment, fake, fakeDb } from '../../fakes/index.ts';
import { DIAGNOSTICS_REPORT } from '../../fakes/diagnostics-report.ts';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const NAME = 'voiceroom-diagnostics-2026-11-27-1402.txt';

async function harness(t: TestContext, { ready = true }: { ready?: boolean } = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'voice-room-diagnostics-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const storage = createMediaStorage({ rootDir: root });
  const failed: string[] = [];
  const named: string[] = [];
  const draft = attachment({
    id: ID,
    context: 'dm',
    state: 'pending',
    internalState: 'uploading',
    reservedBytes: Buffer.byteLength(DIAGNOSTICS_REPORT),
    metadata: { kind: 'diagnostics' }
  });
  const service = createMediaService({
    attachmentRepository: fake<AttachmentRepository>({
      findById: async () => draft,
      withAttachmentLock: async (_id, operation) => operation(fakeDb()),
      async markFileReady(id, data) {
        named.push(data.originalName);
        if (!ready) return null;
        return attachment({
          ...draft,
          id,
          state: 'ready',
          internalState: 'ready',
          mimeType: 'text/plain',
          originalBytes: data.bytes,
          width: null,
          height: null,
          metadata: { kind: 'diagnostics', originalName: data.originalName }
        });
      },
      async markFailed(_id, code) {
        failed.push(String(code));
        return null;
      }
    }),
    jobRepository: fake<MediaJobRepository>({ enqueue: async () => fake() }),
    pressureService: fake<MediaPressureService>({ assertAcceptingUploads: async () => fake() }),
    quotaService: fake<MediaQuotaService>(),
    storage
  });
  const upload = (input: { mimeType?: string; originalName?: string }) =>
    service.upload({ id: ID, ownerId: 'owner', stream: Readable.from([Buffer.from(DIAGNOSTICS_REPORT)]), ...input });
  const stored = () => fs.existsSync(path.join(root, ID, 'original'));
  return { service, upload, failed, named, stored };
}

test('the file name may come with a folder and the type with a charset', async (t) => {
  const { upload, named } = await harness(t);
  const accepted = await upload({ mimeType: 'Text/Plain; charset=utf-8', originalName: `C:\\Users\\me\\${NAME}` });
  assert.deepEqual(
    [accepted?.state, accepted?.kind, accepted?.name, accepted?.width],
    ['ready', 'diagnostics', NAME, null]
  );
  assert.deepEqual(named, [NAME]);
});

test('a raw upload without a file name is refused and leaves no file', async (t) => {
  const { upload, failed, stored } = await harness(t);
  await assert.rejects(upload({ mimeType: 'text/plain' }), { code: 'media_diagnostics_invalid', statusCode: 400 });
  assert.deepEqual(failed, ['media_diagnostics_invalid']);
  assert.equal(stored(), false);
});

test('an upload that lost the race to another one answers a conflict and removes its file', async (t) => {
  const { upload, failed, stored } = await harness(t, { ready: false });
  await assert.rejects(upload({ mimeType: 'text/plain', originalName: NAME }), {
    code: 'media_state_conflict',
    statusCode: 409
  });
  assert.deepEqual(failed, ['media_state_conflict']);
  assert.equal(stored(), false);
});

test('an image slot reports its kind as image, and an unknown kind of slot is refused', async (t) => {
  const { service } = await harness(t);
  await assert.rejects(service.createSlot({ ownerId: 'owner', context: 'dm', clientRequestId: 'r', kind: 'pdf' }), {
    code: 'media_type_unsupported'
  });
  const image = attachment({ id: ID, metadata: { originalName: 'cat.png' } });
  assert.deepEqual(publicAttachment({ ...image, metadata: image.metadata }), {
    id: ID,
    context: 'room',
    order: 0,
    mimeType: 'image/webp',
    bytes: 10,
    width: 10,
    height: 10,
    state: 'ready',
    url: `/api/media/attachments/${ID}/preview`,
    kind: 'image',
    name: null
  });
  // A row without readable metadata is an image too.
  assert.equal(publicAttachment({ ...image, metadata: null }).kind, 'image');
  assert.equal(publicAttachment({ ...image, state: 'processing' }).url, null);
});

function visibility(row: Attachment, opened: { fail?: boolean } = {}) {
  const invariants: string[] = [];
  const service = createMediaVisibilityService({
    attachmentRepository: fake<AttachmentRepository>({ findById: async () => row }),
    authorizeDirectAttachment: async () => true,
    storage: {
      async openRead(_id, variant) {
        if (opened.fail) throw new Error('missing');
        return { key: `${ID}/${String(variant)}`, bytes: 3, stream: Readable.from([Buffer.from(String(variant))]) };
      }
    },
    onAuthorizationInvariantFailure: () => invariants.push('failure')
  });
  return { service, invariants };
}

const file = attachment({
  id: ID,
  context: 'dm',
  mimeType: 'text/plain',
  width: null,
  height: null,
  boundAt: new Date(0),
  directMessageId: 'm1',
  metadata: { kind: 'diagnostics', originalName: NAME }
});

test('a file opens only as itself, as a download that must not be sniffed', async () => {
  const { service } = visibility(file);
  const opened = await service.open({ attachmentId: ID, variant: 'file', viewerId: 'owner' });
  assert.deepEqual(openedMediaHeaders(opened, false), {
    'Content-Disposition': `attachment; filename="${NAME}"`,
    'Content-Length': '3',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  for (const variant of ['preview', 'processed', 'original']) {
    await assert.rejects(service.open({ attachmentId: ID, variant, viewerId: 'owner' }), { statusCode: 404 });
  }
  // An image has no file variant.
  const image = visibility(attachment({ id: ID, context: 'dm', boundAt: new Date(0), directMessageId: 'm1' }));
  await assert.rejects(image.service.open({ attachmentId: ID, variant: 'file', viewerId: 'owner' }), {
    statusCode: 404
  });
  const preview = await image.service.open({ attachmentId: ID, variant: 'preview', viewerId: 'owner' });
  assert.equal(openedMediaHeaders(preview, true)['Content-Disposition'], 'attachment; filename="image.webp"');
  assert.equal(openedMediaHeaders(preview, false)['Content-Disposition'], 'inline; filename="image.webp"');
});

test('a file without its name, or whose bytes are gone, answers like a missing one', async () => {
  const nameless = visibility(attachment({ ...file, metadata: { kind: 'diagnostics' } }));
  await assert.rejects(nameless.service.open({ attachmentId: ID, variant: 'file', viewerId: 'owner' }), {
    statusCode: 404
  });
  assert.deepEqual(nameless.invariants, []);
  const gone = visibility(file, { fail: true });
  await assert.rejects(gone.service.open({ attachmentId: ID, variant: 'file', viewerId: 'owner' }), {
    statusCode: 404
  });
  assert.deepEqual(gone.invariants, ['failure']);
});
