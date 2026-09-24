// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';

import { runMigrations } from '../src/lib/migrate.ts';
import { createRoomStore } from '../src/lib/room-store.ts';
import { createUserStore } from '../src/lib/user-store.ts';
import { createLinkPreviewRepository } from '../src/domains/link-previews/link-preview-repository.ts';
import { FAILED_TTL_MS, createLinkPreviewService } from '../src/domains/link-previews/link-preview-service.ts';
import { createLinkPreviewStorage, reconcileLinkPreviewImages } from '../src/lib/link-preview-storage.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const MIGRATIONS_DIR = path.join(import.meta.dirname, '../src/migrations');
const KEY = `lp_${'ab'.repeat(16)}.webp`;
const OTHER_KEY = `lp_${'cd'.repeat(16)}.webp`;
const PAGE = '<html><head><title>fallback</title><meta property="og:title" content="Пост про котов"><meta property="og:image" content="/cover.png"></head><body></body></html>';

async function setup(t, { fetchPage } = {}) {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const pool = new Pool({ connectionString: databaseUrl });
  const rooms = createRoomStore({ databaseUrl, logger: SILENT });
  const users = createUserStore({ databaseUrl, logger: SILENT });
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-previews-'));
  t.after(async () => {
    await Promise.all([rooms.close(), users.close(), pool.end()]);
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    await cleanup();
  });

  const clock = { now: 1_000_000 };
  const fetches = { pages: 0, images: 0 };
  const published = { room: [], direct: [] };
  const storage = createLinkPreviewStorage({ uploadsDir });
  const repository = createLinkPreviewRepository({ pool });
  const service = createLinkPreviewService({
    repository,
    storage,
    fetcher: {
      async fetchPage(url) {
        fetches.pages += 1;
        if (fetchPage) return fetchPage(url);
        return { url, contentType: 'text/html; charset=utf-8', body: Buffer.from(PAGE) };
      },
      async fetchImage() {
        fetches.images += 1;
        return { body: Buffer.from('original image') };
      }
    },
    processImage: async () => ({ key: KEY, buffer: Buffer.from('webp'), width: 640, height: 360 }),
    onRoomPreview: async (event) => { published.room.push(event); },
    onDirectPreview: async (event) => { published.direct.push(event); },
    logger: SILENT,
    now: () => clock.now
  });

  const { user: ada } = await users.createUser({ login: 'ada', password: 'lovelace-1843' });
  const { user: grace } = await users.createUser({ login: 'grace', password: 'cobol-1959' });
  await rooms.createRoom({ creatorIp: 'ip', isStatic: true, roomId: 'lp-room', now: 1000 });
  return { ada, clock, fetches, grace, pool, published, repository, rooms, service, storage };
}

const EXPECTED_PREVIEW = {
  url: 'https://example.com/post',
  title: 'Пост про котов',
  description: '',
  siteName: 'example.com',
  image: { key: KEY, width: 640, height: 360 }
};

test('a room message gets the preview of its first link, and the cache spares a second fetch', async (t) => {
  const { ada, fetches, published, rooms, service, storage } = await setup(t);
  const text = 'глянь https://example.com/post и https://other.example';
  for (const id of ['lp-1', 'lp-2']) {
    await rooms.appendMessage('lp-room', { id, text, authorUserId: ada.id, createdAt: 2000 }, 2000);
    await service.previewRoomMessage({ roomId: 'lp-room', messageId: id, text });
  }

  assert.deepEqual(fetches, { pages: 1, images: 1 });
  assert.deepEqual((await rooms.getMessage('lp-room', 'lp-1')).linkPreview, EXPECTED_PREVIEW);
  assert.deepEqual((await rooms.getMessage('lp-room', 'lp-2')).linkPreview, EXPECTED_PREVIEW);
  assert.deepEqual(published.room, [{ roomId: 'lp-room', messageId: 'lp-1' }, { roomId: 'lp-room', messageId: 'lp-2' }]);
  assert.deepEqual(await storage.listKeys(), [KEY]);

  // Building it again changes nothing, so nobody is told again.
  await service.previewRoomMessage({ roomId: 'lp-room', messageId: 'lp-1', text });
  assert.equal(published.room.length, 2);
});

test('an edit that drops the link removes the preview, and a stale result never lands', async (t) => {
  const { ada, published, rooms, service } = await setup(t);
  const text = 'https://example.com/post';
  await rooms.appendMessage('lp-room', { id: 'lp-edit', text, authorUserId: ada.id, createdAt: 2000 }, 2000);
  await service.previewRoomMessage({ roomId: 'lp-room', messageId: 'lp-edit', text });
  assert.ok((await rooms.getMessage('lp-room', 'lp-edit')).linkPreview);

  await rooms.editMessage('lp-room', 'lp-edit', 'передумал, без ссылки');
  // The preview built for the old text finishes late: the message moved on.
  await service.previewRoomMessage({ roomId: 'lp-room', messageId: 'lp-edit', text });
  assert.ok((await rooms.getMessage('lp-room', 'lp-edit')).linkPreview, 'the late result did not touch the edited message');
  assert.equal(published.room.length, 1);

  await service.previewRoomMessage({ roomId: 'lp-room', messageId: 'lp-edit', text: 'передумал, без ссылки' });
  assert.equal((await rooms.getMessage('lp-room', 'lp-edit')).linkPreview, undefined);
  assert.equal(published.room.length, 2);
});

test('a site that cannot be previewed is remembered for a while', async (t) => {
  const { ada, clock, fetches, pool, published, rooms, service } = await setup(t, {
    fetchPage: async () => { throw Object.assign(new Error('private'), { code: 'blocked_address' }); }
  });
  const text = 'http://intranet.example/';
  await rooms.appendMessage('lp-room', { id: 'lp-fail', text, authorUserId: ada.id, createdAt: 2000 }, 2000);
  await service.previewRoomMessage({ roomId: 'lp-room', messageId: 'lp-fail', text });
  await service.previewRoomMessage({ roomId: 'lp-room', messageId: 'lp-fail', text });

  assert.equal(fetches.pages, 1);
  assert.equal((await rooms.getMessage('lp-room', 'lp-fail')).linkPreview, undefined);
  assert.equal(published.room.length, 0);
  const cached = await pool.query('SELECT status, preview, failure_code FROM link_previews');
  assert.deepEqual(cached.rows, [{ status: 'failed', preview: null, failure_code: 'blocked_address' }]);

  clock.now += FAILED_TTL_MS;
  await service.previewRoomMessage({ roomId: 'lp-room', messageId: 'lp-fail', text });
  assert.equal(fetches.pages, 2);
});

test('direct messages get previews too, and only images nobody uses are swept', async (t) => {
  const { ada, clock, grace, pool, published, repository, service, storage } = await setup(t);
  const messageId = crypto.randomUUID();
  const text = 'смотри https://example.com/post';
  await pool.query(
    `INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at, metadata) VALUES ($1, $2, $3, $4, now(), '{}')`,
    [messageId, ada.id, grace.id, text]
  );

  await service.previewDirectMessage({ messageId, senderId: grace.id, recipientId: ada.id, text });
  assert.equal(published.direct.length, 0, 'only the sender\'s own message is previewed');
  await service.previewDirectMessage({ messageId, senderId: ada.id, recipientId: grace.id, text });
  const stored = await pool.query('SELECT metadata FROM direct_messages WHERE id = $1', [messageId]);
  assert.deepEqual(stored.rows[0].metadata.linkPreview, EXPECTED_PREVIEW);
  assert.deepEqual(published.direct, [{ messageId, senderId: ada.id, recipientId: grace.id }]);

  await storage.save(OTHER_KEY, Buffer.from('unused'));
  assert.equal(await reconcileLinkPreviewImages({ storage, repository }), 1);
  assert.deepEqual(await storage.listKeys(), [KEY]);

  // Once the cache forgets the page, the message still holds on to its image.
  assert.equal(await service.pruneExpired(), 0);
  clock.now += 2 * 24 * 60 * 60 * 1000;
  assert.equal(await service.pruneExpired(), 1);
  assert.equal(await reconcileLinkPreviewImages({ storage, repository }), 0);
  assert.throws(() => storage.createReadStream('../secret.webp'), TypeError);
});

test('the link preview migration applies and rolls back cleanly', async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(async () => {
    await pool.end();
    await cleanup();
  });
  const tableExists = async () => (await pool.query(`SELECT to_regclass('public.link_previews') AS name`)).rows[0].name !== null;

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await tableExists(), true);

  const names = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.cjs')).sort();
  const index = names.indexOf('20260913120000_create_link_previews.cjs');
  assert.notEqual(index, -1);
  for (let step = 0; step < names.length - index; step += 1) {
    assert.equal((await runMigrations({ databaseUrl, direction: 'down', logger: SILENT })).length, 1);
  }
  assert.equal(await tableExists(), false);

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await tableExists(), true);
});
