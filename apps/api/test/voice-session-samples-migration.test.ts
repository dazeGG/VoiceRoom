// A stay's voice minutes are written with the stay, go with the room's
// history after VOICE_HISTORY_KEEP_DAYS and with the stay itself, and the
// table rolls back and forth cleanly.

import test from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { Type } from 'typebox';
import { runMigrations } from '../src/lib/migrate.ts';
import { createVoiceSessionRepository, type VoiceMinuteSample } from '../src/domains/rooms/voice-session.repository.ts';
import { createAdminRoomsRepository } from '../src/domains/admin/admin-rooms.repository.ts';
import { queryRow } from './helpers/checked.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const MINUTE = 60_000;

const minute = (at: number, polls: VoiceMinuteSample['polls']): VoiceMinuteSample => ({
  at,
  polls,
  heard: { packets: 3000, lost: 30, concealedSamples: 0, gaps: 0 },
  heardBy: { packets: 3000, lost: 300, concealedSamples: 576_000, gaps: 240 },
  rttMsSum: 900,
  rttPolls: 20,
  jitterBufferMsSum: 600,
  jitterBufferPolls: 20,
  uplink: { packets: 3000, lost: 300 },
  transport: 'relay'
});

const stay = (roomId: string, joinedAt: number, minutes: VoiceMinuteSample[]) => ({
  roomId,
  userId: null,
  guestName: 'Петя',
  guestId: null,
  client: null,
  os: '',
  browser: '',
  ip: '',
  joinedAt,
  leftAt: joinedAt + 2 * MINUTE,
  minutes
});

const count = async (pool: pg.Pool) =>
  (
    await queryRow(
      pool,
      Type.Object({ count: Type.Integer() }),
      'SELECT count(*)::int AS count FROM voice_session_samples'
    )
  ).count;

test('a stay keeps its voice minutes, read back with their level and numbers', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const joinedAt = Date.UTC(2026, 9, 31, 12, 0);
  await createVoiceSessionRepository({ pool }).recordSessions([
    stay('kitchen', joinedAt, [
      minute(joinedAt, { good: 18, unstable: 1, bad: 1 }),
      minute(joinedAt + MINUTE, { good: 0, unstable: 0, bad: 0 }),
      minute(joinedAt + 2 * MINUTE, { good: 10, unstable: 0, bad: 2 })
    ]),
    stay('kitchen', joinedAt, [])
  ]);
  const { stays } = await createAdminRoomsRepository({ pool }).history({});
  const kept = stays.find((one) => one.minutes.length > 0);
  assert.deepEqual(
    kept?.minutes.map((one) => one.level),
    ['unstable', null, 'bad']
  );
  assert.deepEqual(kept?.minutes[0], {
    at: joinedAt,
    level: 'unstable',
    polls: { good: 18, unstable: 1, bad: 1 },
    heard: { concealedPct: 0, gapsPerMin: 0 },
    heardBy: { concealedPct: 20, gapsPerMin: 240 },
    uplinkLossPct: 10,
    rttMs: 45,
    jitterBufferMs: 30,
    transport: 'relay'
  });
  assert.equal(stays.filter((one) => one.minutes.length === 0).length, 1, 'a stay without stats has none');
});

test(
  "the minutes go with the room's history and with the stay, and the table rolls back cleanly",
  { skip },
  async (t) => {
    const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await runMigrations({ databaseUrl, logger: SILENT });
    const old = Date.UTC(2026, 6, 1);
    const recent = Date.UTC(2026, 9, 30);
    const sessions = createVoiceSessionRepository({ pool });
    await sessions.recordSessions([
      stay('old-room', old, [minute(old, { good: 20, unstable: 0, bad: 0 })]),
      stay('new-room', recent, [minute(recent, { good: 20, unstable: 0, bad: 0 })])
    ]);
    assert.equal(await count(pool), 2);

    assert.equal(await sessions.forgetRoomsBefore(new Date(old + 1000)), 1);
    assert.equal(await count(pool), 1, "only the forgotten stay's minutes go");
    await pool.query("DELETE FROM voice_sessions WHERE room_id = 'new-room'");
    assert.equal(await count(pool), 0, 'a deleted stay takes its minutes along');

    await rollBackThrough(databaseUrl, '20261031120000_create_voice_session_samples');
    await assert.rejects(pool.query('SELECT 1 FROM voice_session_samples'), /does not exist/);
    await runMigrations({ databaseUrl, logger: SILENT });
    assert.equal(await count(pool), 0);
  }
);
