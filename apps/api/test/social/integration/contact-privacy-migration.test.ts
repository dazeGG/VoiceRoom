import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../../src/lib/migrate.ts';
import { kyselyOn } from '../../../src/platform/db/kysely.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { rollBackThrough } from '../../migration-steps.ts';

const migration = '20261127130000_create_contact_privacy';
const quiet = { log() {}, info() {}, warn() {}, error() {} };

test('privacy backfill ignores same-sender call items and resets after a peer call, then rolls back', async (t) => {
  const { databaseUrl, pool } = await createTestDatabase(t);
  const db = kyselyOn(pool);
  await rollBackThrough(databaseUrl, migration);
  await pool.query(`
    INSERT INTO users (id, login, display_name, password_hash) VALUES ('a','alice','Alice','x'),('b','bob','Bob','x'),('c','carol','Carol','x');
    INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at) VALUES
      ('m1','b','a','First','2026-08-01 12:00Z'), ('m2','a','b','Reply','2026-08-01 12:01Z'),
      ('m3','a','b','Latest','2026-08-01 12:02Z'), ('m4','a','c','Only','2026-08-01 12:03Z');
    INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at, metadata) VALUES
      ('m5','a','b','','2026-08-01 12:04Z','{"kind":"voice-call"}'),
      ('m6','a','b','','2026-08-01 12:05Z','{"kind":"room-invite"}'),
      ('m7','c','a','','2026-08-01 12:06Z','{"kind":"voice-call"}');
  `);
  await runMigrations({ databaseUrl, logger: quiet });
  assert.deepEqual(
    await db.selectFrom('users').select(['messages_from', 'calls_from']).where('id', '=', 'a').executeTakeFirst(),
    {
      messages_from: 'everyone',
      calls_from: 'friends'
    }
  );
  assert.deepEqual(await db.selectFrom('dm_pair_state').selectAll().orderBy('user_high').execute(), [
    {
      user_low: 'a',
      user_high: 'b',
      initiator_id: 'b',
      first_message_at: new Date('2026-08-01T12:00Z'),
      last_sender_id: 'a',
      unanswered_count: 2,
      started_as_strangers: false
    },
    {
      user_low: 'a',
      user_high: 'c',
      initiator_id: 'a',
      first_message_at: new Date('2026-08-01T12:03Z'),
      last_sender_id: 'c',
      unanswered_count: 0,
      started_as_strangers: false
    }
  ]);
  await rollBackThrough(databaseUrl, migration);
  await assert.rejects(db.selectFrom('users').select('messages_from').execute(), { code: '42703' });
  await assert.rejects(db.selectFrom('contact_allow_list').selectAll().execute(), { code: '42P01' });
  await assert.rejects(db.selectFrom('dm_pair_state').selectAll().execute(), { code: '42P01' });
  assert.equal((await db.selectFrom('direct_messages').select('id').execute()).length, 7);
});

test('privacy backfill replays a stored peer re-ring after the original call and three DMs', async (t) => {
  const { databaseUrl, pool } = await createTestDatabase(t);
  const db = kyselyOn(pool);
  await rollBackThrough(databaseUrl, migration);
  await pool.query(`
    INSERT INTO users (id, login, password_hash) VALUES ('a','alice','x'),('b','bob','x');
    INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at, metadata) VALUES
      ('call','a','b','','2026-08-01 12:00Z','{"kind":"voice-call"}'),
      ('m1','a','b','One','2026-08-01 12:01Z','{}'),
      ('m2','a','b','Two','2026-08-01 12:02Z','{}'),
      ('m3','a','b','Three','2026-08-01 12:03Z','{}');
    INSERT INTO room_rings (
      id, caller_user_id, recipient_user_id, room_id, client_request_id, invite_message_id, created_at,
      purpose, state, revision, expires_at, attempt, attempt_inviter_user_id, call_phase, attempt_result,
      ringing_expires_at, alone_deadline, started_at, mutual_ms, call_revision
    ) VALUES (
      '52bc51a6-b4f9-4149-bc0b-c3aced36e223','a','b','call-room','7e20ca65-2e98-4ed5-a428-2558e348650c',
      'call','2026-08-01 12:00Z','voice-call',NULL,NULL,NULL,2,'b','ringing','pending',
      '2026-08-01 12:04:45Z','2026-08-01 12:09Z','2026-08-01 12:00Z',0,4
    );
  `);
  await runMigrations({ databaseUrl, logger: quiet });
  assert.deepEqual(await db.selectFrom('dm_pair_state').selectAll().execute(), [
    {
      user_low: 'a',
      user_high: 'b',
      initiator_id: 'a',
      first_message_at: new Date('2026-08-01T12:00Z'),
      last_sender_id: 'b',
      unanswered_count: 0,
      started_as_strangers: false
    }
  ]);
});
