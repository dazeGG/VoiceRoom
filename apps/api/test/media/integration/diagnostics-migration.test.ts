// The diagnostics attachment migration both ways. Up lets a direct-message
// attachment be the plain-text diagnostics file, ready without dimensions or
// variants, and nothing else that is not an image. Down (dev and test only)
// deletes the diagnostics files and restores the image-only checks; up again
// is clean.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { sql } from 'kysely';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { runMigrations } from '../../../src/lib/migrate.ts';
import { kyselyOn } from '../../../src/platform/db/kysely.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { rollBackThrough } from '../../migration-steps.ts';

const skip = !process.env.TEST_DATABASE_URL;
const quiet = { log() {}, info() {}, warn() {}, error() {} };
const MIGRATION = '20261128130000_allow_diagnostics_attachments';

type Row = {
  context?: string;
  mime?: string;
  kind?: string | null;
  width?: number | null;
  preview?: string | null;
};

test(
  'up admits the ready diagnostics file only; down deletes it and restores image-only checks',
  { skip },
  async (t) => {
    const { databaseUrl, pool, cleanup } = await createTestDatabase(t);
    const db = kyselyOn(pool);
    t.after(cleanup);
    await rollBackThrough(databaseUrl, MIGRATION);
    await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ('a', 'alice', 'Alice', 'x')`);
    await db
      .insertInto('direct_messages')
      .values({ id: 'm1', sender_id: 'a', recipient_id: OFFICIAL_ACCOUNT_ID, body: 'Photo' })
      .execute();

    // A ready file: the original only, no dimensions, no processed or preview variant.
    const insertFile = async ({
      context = 'dm',
      mime = 'text/plain',
      kind = 'diagnostics',
      width = null
    }: Row = {}) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO message_attachments (id, owner_id, context, state, mime_type, original_bytes, width, height,
         original_storage_key, ready_at, metadata)
       VALUES ($1::uuid, 'a', $2, 'ready', $3, 12, $4, $4, $1::text || '/original', now(),
         CASE WHEN $5::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('kind', $5::text) END)`,
        [id, context, mime, width, kind]
      );
      return id;
    };
    const insertImage = async ({ preview = 'preview' }: Row = {}) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO message_attachments (id, owner_id, context, state, mime_type, original_bytes, processed_bytes,
         preview_bytes, width, height, original_storage_key, processed_storage_key, preview_storage_key, ready_at)
       VALUES ($1::uuid, 'a', 'dm', 'ready', 'image/png', 10, 8, 4, 2, 2, 'original', 'processed', $2, now())`,
        [id, preview]
      );
      return id;
    };
    const refused = { code: '23514' };
    await assert.rejects(insertFile(), refused);
    const boundImages = [await insertImage(), await insertImage()];
    for (const [order, id] of boundImages.entries()) {
      await db
        .updateTable('message_attachments')
        .set({ direct_message_id: 'm1', attachment_order: order, bound_at: new Date() })
        .where('id', '=', id)
        .execute();
    }
    const inFlight = randomUUID();
    await db
      .insertInto('message_attachments')
      .values({
        id: inFlight,
        owner_id: 'a',
        context: 'dm',
        state: 'processing',
        mime_type: 'image/jpeg',
        original_bytes: 8,
        width: 2,
        height: 2,
        original_storage_key: 'in-flight/original',
        uploaded_at: new Date()
      })
      .execute();
    const existing = () =>
      db
        .selectFrom('message_attachments')
        .selectAll()
        .where('id', 'in', [...boundImages, inFlight])
        .orderBy('id')
        .execute();
    const before = await existing();
    const constraints = async () =>
      (
        await sql<{ conname: string; convalidated: boolean }>`
      SELECT conname, convalidated FROM pg_constraint
      WHERE conrelid = 'message_attachments'::regclass AND conname IN (
        'message_attachments_mime_check', 'message_attachments_ready_check'
      ) ORDER BY conname
    `.execute(db)
      ).rows;
    const validated = [
      { conname: 'message_attachments_mime_check', convalidated: true },
      { conname: 'message_attachments_ready_check', convalidated: true }
    ];
    assert.equal(before.length, 3);
    assert.deepEqual(await constraints(), validated);

    await runMigrations({ databaseUrl, logger: quiet });
    assert.deepEqual(await existing(), before);
    assert.deepEqual(await constraints(), validated);
    const file = await insertFile();
    await assert.rejects(insertFile({ kind: null }), refused);
    await assert.rejects(insertFile({ context: 'room' }), refused);
    await assert.rejects(insertFile({ width: 10 }), refused);
    await assert.rejects(insertFile({ mime: 'application/pdf' }), refused);
    // An image still needs every variant.
    await assert.rejects(insertImage({ preview: null }), refused);

    await rollBackThrough(databaseUrl, MIGRATION);
    assert.equal(
      await db.selectFrom('message_attachments').select('id').where('id', '=', file).executeTakeFirst(),
      undefined
    );
    assert.deepEqual(await existing(), before);
    assert.deepEqual(await constraints(), validated);
    await assert.rejects(insertFile(), refused);

    await runMigrations({ databaseUrl, logger: quiet });
    assert.deepEqual(await existing(), before);
    assert.deepEqual(await constraints(), validated);
    await insertFile();
  }
);
