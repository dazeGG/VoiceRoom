import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAttachmentRepository } from '../../../src/domains/media/attachment.repository.ts';
import { createTestDatabase } from '../../db-harness.ts';

test('media reconciliation CLI reports a missing ready image as P0 and marks it unavailable', async (t) => {
  const db = await createTestDatabase(t);
  t.after(db.cleanup);
  await using media = await mkdtempDisposable(path.join(tmpdir(), 'vr-reconcile-'));
  const run = () =>
    spawnSync(process.execPath, [path.join(import.meta.dirname, '../../../src/scripts/reconcile-media.ts')], {
      env: { ...process.env, DATABASE_URL: db.databaseUrl, MEDIA_STORAGE_DIR: media.path },
      encoding: 'utf8',
      timeout: 30_000
    });
  const empty = run();
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout), {
    severity: 'ok',
    databaseFiles: 0,
    filesystemFiles: 0,
    markedUnavailable: 0,
    orphanFilesRemoved: 0,
    processingJobsRecovered: 0
  });

  await db.pool.query(
    "INSERT INTO users (id, login, display_name, password_hash) VALUES ('owner', 'owner', 'Owner', 'x')"
  );
  const attachments = createAttachmentRepository({ pool: db.pool });
  const draft = await attachments.createDraft({ ownerId: 'owner', context: 'room' });
  assert.ok(draft);
  await attachments.markUploaded(draft.id, {
    mimeType: 'image/png',
    bytes: 12,
    width: 1,
    height: 1,
    originalStorageKey: `${draft.id}/original`
  });
  await attachments.markReady(draft.id, {
    processedStorageKey: `${draft.id}/processed`,
    previewStorageKey: `${draft.id}/preview`,
    processedBytes: 8,
    previewBytes: 4
  });
  const missing = run();
  assert.equal(missing.status, 2, missing.stderr);
  assert.deepEqual(JSON.parse(missing.stdout), {
    severity: 'p0',
    databaseFiles: 3,
    filesystemFiles: 0,
    markedUnavailable: 1,
    orphanFilesRemoved: 0,
    processingJobsRecovered: 0
  });
  assert.equal((await attachments.findById(draft.id))?.failureCode, 'media_missing');
});
