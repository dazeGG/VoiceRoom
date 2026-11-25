// A stay's voice minutes are written with the stay, go with the room's
// history after VOICE_HISTORY_KEEP_DAYS and with the stay itself, and the
// table rolls back and forth cleanly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'kysely';
import type pg from 'pg';
import { Type } from 'typebox';
import type { NetworkLevel } from '@voiceroom/shared/contracts/rooms';
import { runMigrations } from '../../../src/lib/migrate.ts';
import { kyselyOn } from '../../../src/platform/db/kysely.ts';
import {
  createVoiceSessionRepository,
  type VoiceMinuteSample
} from '../../../src/domains/rooms/voice-session.repository.ts';
import {
  QUALITY_COLUMNS,
  createAdminRoomsRepository,
  minuteLevel,
  qualityOf
} from '../../../src/domains/admin/admin-rooms.repository.ts';
import { queryRow } from '../../helpers/checked.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { rollBackThrough } from '../../migration-steps.ts';

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
  mic: { expectedMs: 60_000, deliveredMs: 21_000, contextMs: 59_000, reopens: 1, replacements: 2 },
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
      {
        ...minute(joinedAt, { good: 13, unstable: 7, bad: 0 }),
        causes: { heard_badly: 0, hears_badly: 5, delay: 2 },
        worstHeardBy: { concealedPct: 31.5, gaps: 12 }
      },
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
    polls: { good: 13, unstable: 7, bad: 0 },
    causes: { heard_badly: 0, hears_badly: 5, delay: 2 },
    heard: { concealedPct: 0, gapsPerMin: 0, speechS: 60 },
    heardBy: { concealedPct: 20, gapsPerMin: 240, speechS: 60, worstConcealedPct: 31.5, worstGaps: 12 },
    uplinkLossPct: 10,
    rttMs: 45,
    jitterBufferMs: 30,
    transport: 'relay'
  });
  assert.equal(stays.filter((one) => one.minutes.length === 0).length, 1, 'a stay without stats has none');
  assert.deepEqual(
    {
      ...(await queryRow(
        pool,
        Type.Object({
          mic_expected_ms: Type.Integer(),
          mic_delivered_ms: Type.Integer(),
          mic_context_ms: Type.Integer(),
          mic_reopens: Type.Integer(),
          mic_replacements: Type.Integer()
        }),
        'SELECT mic_expected_ms, mic_delivered_ms, mic_context_ms, mic_reopens, mic_replacements FROM voice_session_samples LIMIT 1'
      ))
    },
    { mic_expected_ms: 60_000, mic_delivered_ms: 21_000, mic_context_ms: 59_000, mic_reopens: 1, mic_replacements: 2 }
  );
});

test('a minute one trouble passed through is good, and the panel and the SQL read it the same', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const cases: [VoiceMinuteSample['polls'], NetworkLevel | null][] = [
    [{ good: 15, unstable: 5, bad: 0 }, 'good'], // One trouble stays in the window for five polls.
    [{ good: 14, unstable: 6, bad: 0 }, 'good'],
    [{ good: 13, unstable: 7, bad: 0 }, 'unstable'], // A third of the minute.
    [{ good: 19, unstable: 0, bad: 1 }, 'good'],
    [{ good: 18, unstable: 0, bad: 2 }, 'bad'],
    [{ good: 2, unstable: 2, bad: 0 }, 'unstable'], // The end of a stay, with few polls.
    [{ good: 0, unstable: 1, bad: 0 }, 'good'], // One poll says nothing.
    [{ good: 0, unstable: 0, bad: 0 }, null]
  ];
  const at = Date.UTC(2026, 9, 31, 12, 0);
  await createVoiceSessionRepository({ pool }).recordSessions(
    cases.map(([polls], index) => stay(`room-${index}`, at, [minute(at, polls)]))
  );
  const { rows } = await sql<{ room_id: string; good: unknown; unstable: unknown; bad: unknown }>`
    SELECT s.room_id, ${QUALITY_COLUMNS}
    FROM voice_session_samples m JOIN voice_sessions s ON s.id = m.stay_id
    GROUP BY s.room_id`.execute(kyselyOn(pool));
  const counted = new Map(rows.map((row) => [row.room_id, qualityOf(row)]));
  assert.equal(counted.size, cases.length);
  cases.forEach(([polls, level], index) => {
    const label = JSON.stringify(polls);
    assert.equal(minuteLevel(polls), level, `the panel on ${label}`);
    assert.deepEqual(
      counted.get(`room-${index}`),
      level ? { good: 0, unstable: 0, bad: 0, [level]: 1 } : null,
      `the SQL on ${label}`
    );
  });
});

test(
  'receive engine and aggregate native concealment persist; rollback retains existing minutes',
  { skip },
  async (t) => {
    const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
    t.after(cleanup);
    const migration = '20261124130000_keep_voice_receive_engine';
    const oldStay = 'a5acab6c-f24d-42bf-801c-1fa590f108c9';
    const at = Date.UTC(2026, 9, 31, 12, 0);
    await rollBackThrough(databaseUrl, migration);
    await pool.query('INSERT INTO voice_sessions (id, joined_at, left_at) VALUES ($1, $2, $2)', [
      oldStay,
      new Date(at)
    ]);
    await pool.query('INSERT INTO voice_session_samples (stay_id, at, heard_packets) VALUES ($1, $2, 10)', [
      oldStay,
      new Date(at)
    ]);
    await runMigrations({ databaseUrl, logger: SILENT });

    const readSamples = async () =>
      (
        await pool.query<{
          receive_engine: string | null;
          native_heard_concealed: number | null;
          native_heard_gaps: number | null;
          heard_packets: number;
        }>(`SELECT receive_engine, native_heard_concealed, native_heard_gaps, heard_packets
        FROM voice_session_samples ORDER BY at`)
      ).rows;
    const legacy = { receive_engine: null, native_heard_concealed: null, native_heard_gaps: null, heard_packets: 10 };
    assert.deepEqual(await readSamples(), [legacy]);
    await createVoiceSessionRepository({ pool }).recordSessions([
      stay('kitchen', at + MINUTE, [
        { ...minute(at + MINUTE, { good: 0, unstable: 0, bad: 0 }), receiveEngine: 'browser' },
        {
          ...minute(at + 2 * MINUTE, { good: 0, unstable: 0, bad: 0 }),
          receiveEngine: 'native',
          nativeHeard: { concealedSamples: 960, gaps: 2 }
        }
      ])
    ]);
    assert.deepEqual(await readSamples(), [
      legacy,
      { ...legacy, receive_engine: 'browser', heard_packets: 3000 },
      { receive_engine: 'native', native_heard_concealed: 960, native_heard_gaps: 2, heard_packets: 3000 }
    ]);
    await assert.rejects(pool.query("UPDATE voice_session_samples SET receive_engine = 'unknown'"), /check constraint/);

    await rollBackThrough(databaseUrl, migration);
    await assert.rejects(readSamples(), /does not exist/);
    assert.equal(await count(pool), 3);
    await runMigrations({ databaseUrl, logger: SILENT });
    assert.deepEqual(await readSamples(), [
      legacy,
      { ...legacy, heard_packets: 3000 },
      { ...legacy, heard_packets: 3000 }
    ]);
  }
);

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

    await rollBackThrough(databaseUrl, '20261104180000_keep_voice_minute_worst_and_causes');
    await assert.rejects(pool.query('SELECT polls_delay FROM voice_session_samples'), /does not exist/);
    await assert.rejects(pool.query('SELECT heard_worst_gaps FROM voice_session_samples'), /does not exist/);
    await pool.query('SELECT cpu_polls FROM voice_session_samples');
    await runMigrations({ databaseUrl, logger: SILENT });
    await pool.query('SELECT polls_delay, heard_by_worst_concealed_pct FROM voice_session_samples');

    await rollBackThrough(databaseUrl, '20261102120000_add_mic_to_voice_session_samples');
    await pool.query('SELECT 1 FROM voice_session_samples');
    await assert.rejects(pool.query('SELECT mic_expected_ms FROM voice_session_samples'), /does not exist/);
    await runMigrations({ databaseUrl, logger: SILENT });
    await pool.query('SELECT mic_expected_ms FROM voice_session_samples');

    await rollBackThrough(databaseUrl, '20261031120000_create_voice_session_samples');
    await assert.rejects(pool.query('SELECT 1 FROM voice_session_samples'), /does not exist/);
    await runMigrations({ databaseUrl, logger: SILENT });
    assert.equal(await count(pool), 0);
  }
);
