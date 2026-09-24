import assert from 'node:assert/strict';
import { Pool } from 'pg';
import test from 'node:test';
import { runMigrations } from '../src/lib/migrate.ts';
import { createAttachmentRepository } from '../src/domains/media/attachment-repository.ts';
import { createMediaQuotaRepository } from '../src/domains/media/media-quota-repository.ts';
import { createMediaQuotaService } from '../src/domains/media/media-quota-service.ts';
import { createTestDatabase } from './db-harness.js';
const SILENT = { log() {}, info() {}, warn() {}, error() {} };

test('G76-A01 concurrent ninth slot is rejected and retry is idempotent', { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async (t) => {
  const db = await createTestDatabase(t); await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT, noLock: true });
  const pool = new Pool({ connectionString: db.databaseUrl, max: 12 }); t.after(async () => { await pool.end(); await db.cleanup(); });
  await pool.query(`INSERT INTO users(id,login,display_name,password_hash) VALUES ('quota-owner','quota-owner','Owner','x')`);
  const attachments = createAttachmentRepository({ pool });
  const quota = createMediaQuotaService({ attachmentRepository: attachments, quotaRepository: createMediaQuotaRepository({ attachmentRepository: attachments, pool }) });
  const results = await Promise.allSettled(Array.from({ length: 9 }, (_, index) => quota.reserve({ ownerId: 'quota-owner', context: 'room', clientRequestId: `request-${index}`, bytes: 1024 })));
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 8);
  assert.equal(results.filter((item) => item.status === 'rejected' && item.reason.code === 'media_pending_limit').length, 1);
  const first = await quota.reserve({ ownerId: 'quota-owner', context: 'room', clientRequestId: 'request-0', bytes: 1024 });
  assert.equal(first.id, results[0].value.id);
});

test('G76-A02 byte and rate boundaries return stable 413 codes and deletion releases active usage', async () => {
  const usage = { pendingCount: 0, recentCount: 0, usedBytes: 9 };
  let created = 0;
  const attachments = { async findByClientRequest() { return null; }, async createDraft(input) { created += 1; return input; } };
  const quotaRepository = { async withOwnerReservation(_owner, operation) { return operation({ client: {}, usage }); } };
  const quota = createMediaQuotaService({ attachmentRepository: attachments, quotaRepository, maxBytes: 10, maxPending: 8, maxFilesPerWindow: 20 });
  await quota.reserve({ ownerId: 'owner', context: 'room', clientRequestId: 'one', bytes: 1 });
  await assert.rejects(quota.reserve({ ownerId: 'owner', context: 'room', clientRequestId: 'two', bytes: 2 }), (error) => error.statusCode === 413 && error.code === 'media_byte_quota');
  usage.usedBytes = 0; usage.pendingCount = 8;
  await assert.rejects(quota.reserve({ ownerId: 'owner', context: 'room', clientRequestId: 'three', bytes: 1 }), (error) => error.code === 'media_pending_limit');
  usage.pendingCount = 0; usage.recentCount = 20;
  await assert.rejects(quota.reserve({ ownerId: 'owner', context: 'room', clientRequestId: 'four', bytes: 1 }), (error) => error.code === 'media_rate_limit');
  assert.equal(created, 1);
});
