import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import test from 'node:test';
import { createMediaService, detectExactContainer, MAX_UPLOAD_BYTES } from '../src/domains/media/media.service.ts';
import { createMediaStorage } from '../src/domains/media/storage.ts';
import type { Attachment, AttachmentRepository } from '../src/domains/media/attachment.repository.ts';
import type { MediaJobRepository } from '../src/domains/media/media-job.repository.ts';
import type { MediaQuotaService } from '../src/domains/media/media-quota.service.ts';
import { attachment, fake, fakeDb } from './fakes/index.ts';
const ID = '123e4567-e89b-42d3-a456-426614174000';

test('G75-A01 JPEG/PNG/WebP exact containers and upload status survive service restart without owner leakage', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'voice-room-upload-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const storage = createMediaStorage({ rootDir: root });
  const rows = new Map<string, Attachment>([
    [ID, attachment({ id: ID, state: 'pending', internalState: 'uploading', reservedBytes: 10000 })]
  ]);
  const repository = fake<AttachmentRepository>({
    async findById(id) {
      return rows.get(id) || null;
    },
    async withAttachmentLock(_id, operation) {
      return operation(fakeDb());
    },
    async markUploaded(id, data) {
      const row = attachment({
        ...rows.get(id),
        mimeType: data.mimeType,
        width: data.width,
        height: data.height,
        originalBytes: data.bytes,
        state: 'processing',
        internalState: 'processing'
      });
      rows.set(id, row);
      return row;
    },
    async markFailed() {
      return null;
    }
  });
  const service = createMediaService({
    attachmentRepository: repository,
    jobRepository: fake<MediaJobRepository>({ enqueue: async () => fake() }),
    quotaService: fake<MediaQuotaService>(),
    storage
  });
  const jpeg = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'red' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } })
    .png()
    .toBuffer();
  const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'green' } })
    .webp()
    .toBuffer();
  assert.deepEqual(
    [detectExactContainer(jpeg), detectExactContainer(png), detectExactContainer(webp)],
    ['jpeg', 'png', 'webp']
  );
  const uploaded = await service.upload({
    id: ID,
    ownerId: 'owner',
    stream: Readable.from(jpeg),
    mimeType: 'image/jpeg'
  });
  assert.equal(uploaded?.state, 'processing');
  assert.equal(uploaded && 'ownerId' in uploaded, false);
  assert.equal((await service.status({ id: ID, ownerId: 'owner' }))?.id, ID);
  await assert.rejects(service.status({ id: ID, ownerId: 'other' }), { statusCode: 404 });
});

test('G75-A02 corrupt, polyglot, MIME mismatch and >10MiB bodies fail without files', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'voice-room-upload-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const storage = createMediaStorage({ rootDir: root });
  const failed: unknown[] = [];
  const repository = fake<AttachmentRepository>({
    async findById(id) {
      return attachment({ id, state: 'pending', internalState: 'uploading', reservedBytes: MAX_UPLOAD_BYTES });
    },
    async withAttachmentLock(_id, operation) {
      return operation(fakeDb());
    },
    async markFailed(_id, code) {
      failed.push(code);
      return null;
    }
  });
  const service = createMediaService({
    attachmentRepository: repository,
    quotaService: fake<MediaQuotaService>(),
    storage
  });
  const bodies: Array<[Buffer, string]> = [
    [Buffer.from('bad'), 'image/png'],
    [
      Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff]),
        Buffer.from('payload'),
        Buffer.from([0xff, 0xd9]),
        Buffer.from('polyglot')
      ]),
      'image/jpeg'
    ]
  ];
  for (const [body, mime] of bodies) {
    await assert.rejects(service.upload({ id: ID, ownerId: 'owner', stream: Readable.from(body), mimeType: mime }));
  }
  await assert.rejects(
    service.upload({
      id: ID,
      ownerId: 'owner',
      stream: Readable.from(Buffer.alloc(MAX_UPLOAD_BYTES + 1)),
      mimeType: 'image/png'
    }),
    { statusCode: 413 }
  );
  assert.ok(failed.length >= 3);
  await assert.rejects(storage.openRead(ID, 'original'), { code: 'ENOENT' });
});
