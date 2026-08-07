'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const sharp = require('sharp');
const test = require('node:test');
const { createMediaService, detectExactContainer, MAX_UPLOAD_BYTES } = require('../src/domains/media/media-service');
const { createMediaStorage } = require('../src/domains/media/storage');
const ID = '123e4567-e89b-42d3-a456-426614174000';

test('G75-A01 JPEG/PNG/WebP exact containers and upload status survive service restart without owner leakage', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'voice-room-upload-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const storage = createMediaStorage({ rootDir: root });
  const rows = new Map([[ID, { id: ID, ownerId: 'owner', context: 'room', state: 'pending', internalState: 'uploading', deletedAt: null, reservedBytes: 10000 }]]);
  const repository = {
    async findById(id) { return rows.get(id) || null; },
    async withAttachmentLock(_id, operation) { return operation(); },
    async markUploaded(id, data) { const row = { ...rows.get(id), ...data, originalBytes: data.bytes, state: 'processing', internalState: 'processing' }; rows.set(id, row); return row; },
    async markFailed() {}, async markDeleted() {}, async clearPhysicalData() {}
  };
  const service = createMediaService({ attachmentRepository: repository, jobRepository: { async enqueue() {} }, quotaService: { async reserve() {} }, storage });
  const jpeg = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'red' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'green' } }).webp().toBuffer();
  assert.deepEqual([detectExactContainer(jpeg), detectExactContainer(png), detectExactContainer(webp)], ['jpeg', 'png', 'webp']);
  const uploaded = await service.upload({ id: ID, ownerId: 'owner', stream: Readable.from(jpeg), mimeType: 'image/jpeg' });
  assert.equal(uploaded.state, 'processing');
  assert.equal('ownerId' in uploaded, false);
  assert.equal((await service.status({ id: ID, ownerId: 'owner' })).id, ID);
  await assert.rejects(service.status({ id: ID, ownerId: 'other' }), (error) => error.statusCode === 404);
});

test('G75-A02 corrupt, polyglot, MIME mismatch and >10MiB bodies fail without files', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'voice-room-upload-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const storage = createMediaStorage({ rootDir: root });
  const failed = [];
  const repository = {
    async findById(id) { return { id, ownerId: 'owner', context: 'room', state: 'pending', internalState: 'uploading', deletedAt: null, reservedBytes: MAX_UPLOAD_BYTES }; },
    async withAttachmentLock(_id, operation) { return operation(); },
    async markFailed(_id, code) { failed.push(code); }
  };
  const service = createMediaService({ attachmentRepository: repository, quotaService: { async reserve() {} }, storage });
  for (const [body, mime] of [[Buffer.from('bad'), 'image/png'], [Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('payload'), Buffer.from([0xff, 0xd9]), Buffer.from('polyglot')]), 'image/jpeg']]) {
    await assert.rejects(service.upload({ id: ID, ownerId: 'owner', stream: Readable.from(body), mimeType: mime }));
  }
  await assert.rejects(service.upload({ id: ID, ownerId: 'owner', stream: Readable.from(Buffer.alloc(MAX_UPLOAD_BYTES + 1)), mimeType: 'image/png' }), (error) => error.statusCode === 413);
  assert.ok(failed.length >= 3);
  await assert.rejects(storage.openRead(ID, 'original'), (error) => error.code === 'ENOENT');
});
